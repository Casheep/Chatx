"""Detached job supervisor; survives the short-lived native messaging request."""
from __future__ import annotations
import hashlib
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import time
import urllib.request
from native_host import DATA, atomic_json, bounded, config, job_dir, safe_path, publish_exclusive, read_json


def acquire_slot(directory):
    """OS-released lock serializes compute across tabs without stale lock files."""
    lock = (DATA / 'compute.lock').open('a+b')
    lock.seek(0, 2)
    if lock.tell() == 0:
        lock.write(b'0')
        lock.flush()
    while True:
        (directory / 'heartbeat').touch()
        if (directory / 'cancel').exists():
            lock.close()
            return None
        lock.seek(0)
        try:
            if os.name == 'nt':
                import msvcrt
                msvcrt.locking(lock.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            return lock
        except OSError:
            time.sleep(.3)


def stop_tree(process):
    if os.name == 'nt':
        subprocess.run(['taskkill.exe', '/PID', str(process.pid), '/T', '/F'],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, creationflags=0x08000000)
    else:
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass


def download(request, directory, root, deadline):
    args = request['args']
    target = safe_path(root, args['path'])
    target.parent.mkdir(parents=True, exist_ok=True)
    staging = directory / 'download.part'
    maximum = bounded(args.get('max_bytes'), 100*1024*1024, 1, 20*1024**3)
    total = 0
    digest = hashlib.sha256()
    class HTTPSOnly(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, req, fp, code, msg, headers, newurl):
            if not newurl.startswith('https://'):
                raise ValueError('Refusing a redirect to non-HTTPS')
            return super().redirect_request(req, fp, code, msg, headers, newurl)
    opener = urllib.request.build_opener(HTTPSOnly())
    with opener.open(args['url'], timeout=10) as response, staging.open('xb') as output:
        length = response.headers.get('Content-Length')
        if length and int(length) > maximum:
            raise ValueError('下载大小超过 max_bytes')
        while True:
            (directory / 'heartbeat').touch()
            if (directory / 'cancel').exists():
                return 'cancelled', None
            if time.monotonic() > deadline:
                return 'timed_out', None
            chunk = response.read(256*1024)
            if not chunk:
                break
            total += len(chunk)
            if total > maximum:
                raise ValueError('下载大小超过 max_bytes')
            output.write(chunk)
            digest.update(chunk)
    if length and total != int(length):
        raise ValueError('下载长度与 Content-Length 不匹配，未发布文件')
    publish_exclusive(staging, target)
    staging.unlink()
    (directory / 'stdout.log').write_text(json.dumps({'path': args['path'], 'bytes': total,
        'sha256': digest.hexdigest()}, ensure_ascii=False), encoding='utf-8')
    return 'completed', 0


def main(identifier):
    cfg, root = config()
    directory = job_dir(identifier)
    request = read_json(directory / 'request.json')
    state = read_json(directory / 'state.json')
    slot = None
    if request['tool'] != 'download_file':
        state['worker_pid'] = os.getpid()
        atomic_json(directory / 'state.json', state)
        slot = acquire_slot(directory)
        if slot is None:
            state.update(status='cancelled', finished_at=time.time(), exit_code=None)
            atomic_json(directory / 'state.json', state)
            return
    state.update(status='running', started_at=time.time(), worker_pid=os.getpid())
    atomic_json(directory / 'state.json', state)
    (directory / 'heartbeat').touch()
    deadline = time.monotonic() + request['timeout']
    process = None
    try:
        if (directory / 'cancel').exists():
            state.update(status='cancelled', exit_code=None)
        elif request['tool'] == 'download_file':
            status, code = download(request, directory, root, deadline)
            state.update(status=status, exit_code=code)
        else:
            if request['tool'] == 'run_python':
                script = directory / 'task.py'
                script.write_text(request['args']['code'], encoding='utf-8')
                command = [cfg.get('python', sys.executable), '-u', str(script)]
            else:
                script = directory / ('task.ps1' if os.name == 'nt' else 'task.sh')
                content = request['args']['command']
                if os.name == 'nt':
                    content = "$ErrorActionPreference='Stop'\n[Console]::OutputEncoding=[Text.UTF8Encoding]::new()\n" + content
                    # Propagate native-command failures too, instead of reporting a false success.
                    content += '\nif ($LASTEXITCODE) { exit $LASTEXITCODE }\n'
                script.write_text(content, encoding='utf-8-sig' if os.name == 'nt' else 'utf-8')
                command = ['powershell.exe', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', str(script)] if os.name == 'nt' else ['/bin/sh', str(script)]
            options = {'creationflags': 0x08000000 | 0x00000200} if os.name == 'nt' else {'start_new_session': True}
            env = {**os.environ, 'PYTHONIOENCODING': 'utf-8', 'PYTHONUNBUFFERED': '1'}
            with (directory / 'stdout.log').open('wb') as out, (directory / 'stderr.log').open('wb') as err:
                process = subprocess.Popen(command, cwd=root, env=env, stdin=subprocess.DEVNULL, stdout=out, stderr=err, **options)
                state['pid'] = process.pid
                atomic_json(directory / 'state.json', state)
                reason = None
                while process.poll() is None:
                    (directory / 'heartbeat').touch()
                    if (directory / 'cancel').exists():
                        reason = 'cancelled'
                    elif time.monotonic() > deadline:
                        reason = 'timed_out'
                    elif sum((directory / f'{n}.log').stat().st_size for n in ('stdout','stderr')) > 32*1024*1024:
                        reason = 'output_limit'
                    if reason:
                        stop_tree(process)
                        process.wait(timeout=10)
                        break
                    time.sleep(0.2)
                code = process.wait()
                state.update(status=reason or ('completed' if code == 0 else 'failed'), exit_code=code)
    except Exception as exc:
        if process and process.poll() is None:
            stop_tree(process)
        state.update(status='failed', error=str(exc))
    finally:
        state['finished_at'] = time.time()
        atomic_json(directory / 'state.json', state)
        (directory / 'heartbeat').touch()
        if slot:
            slot.close()


if __name__ == '__main__':
    main(sys.argv[1])
