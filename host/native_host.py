"""Chatx local executor. Standard library only, no listening socket."""
from __future__ import annotations
import base64
import hashlib
import json
import os
from pathlib import Path
import platform
import re
import shutil
import struct
import subprocess
import sys
import threading
import time
import uuid

BASE = Path(__file__).resolve().parent
DATA = Path(os.environ.get('CHATX_DATA_DIR', str(BASE.parent / 'runtime'))).resolve()


def atomic_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + '.' + uuid.uuid4().hex + '.tmp')
    temporary.write_text(json.dumps(value, ensure_ascii=False), encoding='utf-8')
    # Windows readers/antivirus may briefly hold the destination without delete sharing.
    for attempt in range(12):
        try:
            os.replace(temporary, path)
            break
        except PermissionError:
            if attempt == 11:
                raise
            time.sleep(.05 * (attempt + 1))


def read_json(path):
    for attempt in range(12):
        try:
            return json.loads(path.read_text(encoding='utf-8-sig'))
        except PermissionError:
            if attempt == 11:
                raise
            time.sleep(.025 * (attempt + 1))


def config():
    cfg = read_json(DATA / 'config.json')
    root = Path(cfg['workspace']).resolve()
    root.mkdir(parents=True, exist_ok=True)
    return cfg, root


def publish_exclusive(source, target):
    """Publish only a complete copy, on the target volume, without replacing a file."""
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.parent / ('.chatx-' + uuid.uuid4().hex + '.part')
    try:
        with temporary.open('xb') as dest, source.open('rb') as stream:
            shutil.copyfileobj(stream, dest)
            dest.flush()
            os.fsync(dest.fileno())
        if os.name == 'nt':
            # Windows rename fails if the destination exists, unlike POSIX rename.
            temporary.rename(target)
        else:
            os.link(temporary, target)
    finally:
        temporary.unlink(missing_ok=True)


def safe_path(root, relative):
    # Resolve junctions/symlinks and reject Windows ADS, device names and drive paths.
    if not isinstance(relative, str) or not relative or ':' in relative or '\x00' in relative:
        raise ValueError('路径无效；只接受工作目录内的相对路径')
    p = Path(relative)
    if p.is_absolute() or relative.startswith(('\\', '/')):
        raise ValueError('不允许绝对路径')
    for part in re.split(r'[/\\]', relative):
        if part == '..' or part.endswith((' ', '.')) and part not in ('.',):
            raise ValueError('不允许父目录或带尾部空格/点的路径')
        if re.fullmatch(r'(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\..*)?', part, re.I):
            raise ValueError('不允许 Windows 设备路径')
    target = (root / p).resolve()
    if not target.is_relative_to(root):
        raise ValueError('路径越出工作目录')
    # Keep control files out of the file tool surface, even if root is configured broadly.
    if target.is_relative_to(DATA) or DATA.is_relative_to(target):
        raise ValueError('不能访问桥接运行状态目录')
    return target


def bounded(value, default, low, high):
    result = int(default if value is None else value)
    if not low <= result <= high:
        raise ValueError(f'数值必须在 {low}–{high} 之间')
    return result


def run_capture(args, timeout=12):
    try:
        result = subprocess.run(args, capture_output=True, timeout=timeout,
                                creationflags=0x08000000 if os.name == 'nt' else 0)
        return {'exit_code': result.returncode, 'stdout': result.stdout.decode('utf-8', 'replace')[:16000],
                'stderr': result.stderr.decode('utf-8', 'replace')[:4000]}
    except (OSError, subprocess.TimeoutExpired) as exc:
        return {'error': str(exc)}


def system_info():
    cfg, root = config()
    result = {'os': platform.platform(), 'cpu': platform.processor(), 'logical_cpu_count': os.cpu_count(),
              'python': cfg.get('python', sys.executable), 'workspace': str(root),
              'shell': 'powershell.exe' if os.name == 'nt' else '/bin/sh',
              'execution_boundary': 'File tools are workspace-scoped; Python and shell use your OS account permissions.'}
    if os.name == 'nt':
        result['windows_hardware'] = run_capture(['powershell.exe', '-NoProfile', '-NonInteractive', '-Command',
            "[Console]::OutputEncoding=[Text.UTF8Encoding]::new(); $c=Get-CimInstance Win32_ComputerSystem; "
            "$p=Get-CimInstance Win32_Processor; @{cpu=@($p.Name);ram_bytes=$c.TotalPhysicalMemory}|ConvertTo-Json -Compress"])
    result['nvidia'] = run_capture(['nvidia-smi', '--query-gpu=name,memory.total,memory.free,driver_version,utilization.gpu',
                                  '--format=csv,noheader'])
    return result


def job_dir(job_id):
    if not isinstance(job_id, str) or not re.fullmatch(r'[0-9a-f]{32}', job_id):
        raise ValueError('job_id 无效')
    return DATA / 'jobs' / job_id


def job_status(job_id):
    directory = job_dir(job_id)
    state = read_json(directory / 'state.json')
    logs = {}
    for name in ('stdout', 'stderr', 'supervisor'):
        file = directory / (name + '.log')
        if file.exists():
            with file.open('rb') as stream:
                size = file.stat().st_size
                stream.seek(max(0, size - 24000))
                logs[name] = stream.read(24000).decode('utf-8', 'replace')
            logs[name + '_truncated'] = size > 24000
    # Never claim an orphaned worker succeeded. It may need explicit investigation.
    if state['status'] in ('queued', 'running'):
        heartbeat = directory / 'heartbeat'
        age = time.time() - (heartbeat.stat().st_mtime if heartbeat.exists() else state['created_at'])
        if age > 30:
            state['diagnostic'] = 'Worker heartbeat stale; result unconfirmed. Inspect or cancel the job.'
    return {**state, **logs}


def start_job(tool, args):
    cfg, root = config()
    timeout = bounded(args.get('timeout'), 300, 1, 86400)
    if tool == 'run_python' and (not isinstance(args.get('code'), str) or len(args['code']) > 180000):
        raise ValueError('code 必须是字符串且不超过 180 KB')
    if tool == 'run_shell' and (not isinstance(args.get('command'), str) or len(args['command']) > 180000):
        raise ValueError('command 必须是字符串且不超过 180 KB')
    if tool == 'download_file':
        from urllib.parse import urlparse
        parsed = urlparse(args.get('url', ''))
        if parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.password:
            raise ValueError('下载地址必须是无内嵌凭据的 HTTPS URL')
        target = safe_path(root, args['path'])
        if target.exists():
            raise ValueError('下载目标已存在，不会覆盖')
        bounded(args.get('max_bytes'), 100 * 1024 * 1024, 1, 20 * 1024**3)
    identifier = uuid.uuid4().hex
    directory = job_dir(identifier)
    directory.mkdir(parents=True)
    atomic_json(directory / 'request.json', {'tool': tool, 'args': args, 'timeout': timeout})
    atomic_json(directory / 'state.json', {'job_id': identifier, 'status': 'queued', 'created_at': time.time()})
    python = Path(sys.executable)
    if os.name == 'nt' and python.name.lower() == 'python.exe' and python.with_name('pythonw.exe').exists():
        python = python.with_name('pythonw.exe')
    options = {'creationflags': 0x08000000 | 0x00000200} if os.name == 'nt' else {'start_new_session': True}
    try:
        with (directory / 'supervisor.log').open('wb') as supervisor_log:
            process = subprocess.Popen([str(python), str(BASE / 'worker.py'), identifier], stdin=subprocess.DEVNULL,
                             stdout=supervisor_log, stderr=supervisor_log, close_fds=True, **options)
        # Reap when embedded in a long-lived process/test; do not keep the short native host alive.
        threading.Thread(target=process.wait, daemon=True).start()
    except OSError as exc:
        atomic_json(directory / 'state.json', {'job_id': identifier, 'status': 'failed', 'error': str(exc), 'created_at': time.time()})
        raise
    return {'job_id': identifier, 'status': 'queued'}


def execute(tool, args):
    cfg, root = config()
    if tool == 'system_info':
        return system_info()
    if tool == 'list_files':
        path = safe_path(root, args.get('path', '.'))
        entries = sorted(path.iterdir(), key=lambda p: p.name.lower())
        items = []
        for entry in entries[:200]:
            try:
                safe_path(root, str(entry.relative_to(root)))
                items.append({'name': entry.name, 'directory': entry.is_dir(), 'bytes': entry.stat().st_size})
            except (ValueError, OSError):
                continue
        return {'path': str(path.relative_to(root)), 'entries': items, 'truncated': len(entries) > 200}
    if tool == 'read_file':
        path = safe_path(root, args['path'])
        if path.stat().st_size > 4 * 1024 * 1024:
            raise ValueError('文本超过 4 MiB，请使用 Python 分析后返回摘要')
        content = path.read_text(encoding='utf-8-sig')
        offset = bounded(args.get('offset'), 0, 0, 10**9)
        limit = bounded(args.get('limit'), 12000, 1, 48000)
        return {'content': content[offset:offset+limit], 'total_chars': len(content), 'next_offset': min(len(content), offset+limit)}
    if tool == 'write_file':
        path = safe_path(root, args['path'])
        content = args['content']
        if not isinstance(content, str) or len(content.encode('utf-8')) > 180000:
            raise ValueError('content 必须是小于 180 KB 的文本')
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open('w' if args.get('overwrite') is True else 'x', encoding='utf-8', newline='') as stream:
            stream.write(content)
        return {'path': str(path.relative_to(root)), 'bytes': path.stat().st_size,
                'sha256': hashlib.sha256(path.read_bytes()).hexdigest()}
    if tool in ('run_python', 'run_shell', 'download_file'):
        return start_job(tool, args)
    if tool == 'job_status':
        return job_status(args['job_id'])
    if tool == 'list_jobs':
        limit = bounded(args.get('limit'), 20, 1, 100)
        paths = sorted((DATA / 'jobs').glob('*/state.json'), key=lambda p: p.stat().st_mtime, reverse=True)
        states = []
        for file in paths[:limit]:
            try:
                states.append(read_json(file))
            except (OSError, ValueError):
                continue
        return {'jobs': states, 'truncated': len(paths) > limit}
    if tool == 'job_cancel':
        state = job_status(args['job_id'])
        if state['status'] not in ('queued', 'running'):
            return state
        (job_dir(args['job_id']) / 'cancel').touch()
        return {'job_id': args['job_id'], 'status': 'cancelling'}
    raise ValueError('未知工具')


def upload(message):
    _, root = config()
    action = message['action']
    if action == 'upload_begin':
        name = message['name'].replace('\\', '/').split('/')[-1]
        if not name or len(name) > 180:
            raise ValueError('文件名无效')
        identifier = uuid.uuid4().hex
        relative = f'inbox/{identifier[:10]}-{name}'
        safe_path(root, relative)
        directory = DATA / 'uploads' / identifier
        directory.mkdir(parents=True)
        atomic_json(directory / 'meta.json', {'path': relative, 'size': bounded(message.get('size'), 0, 0, 20*1024**3)})
        (directory / 'data').touch()
        return {'upload_id': identifier}
    identifier = message.get('upload_id', '')
    if not re.fullmatch(r'[0-9a-f]{32}', identifier):
        raise ValueError('upload_id 无效')
    directory = DATA / 'uploads' / identifier
    meta = read_json(directory / 'meta.json')
    data = directory / 'data'
    if action == 'upload_chunk':
        chunk = base64.b64decode(message['data'], validate=True)
        if len(chunk) > 512*1024 or data.stat().st_size != int(message['offset']) or data.stat().st_size+len(chunk) > meta['size']:
            raise ValueError('上传块大小或偏移不匹配')
        with data.open('ab') as stream:
            stream.write(chunk)
        return {'received': data.stat().st_size}
    if action == 'upload_finish':
        if data.stat().st_size != meta['size']:
            raise ValueError('上传未完整，未发布文件')
        target = safe_path(root, meta['path'])
        target.parent.mkdir(parents=True, exist_ok=True)
        publish_exclusive(data, target)
        with target.open('rb') as stream:
            digest = hashlib.sha256()
            while chunk := stream.read(1024*1024):
                digest.update(chunk)
        shutil.rmtree(directory)
        return {'path': meta['path'], 'bytes': meta['size'], 'sha256': digest.hexdigest(), 'raw_file_sent_to_chatgpt': False}
    raise ValueError('未知上传动作')


def handle(message):
    action = message.get('action')
    if action == 'ping':
        cfg, root = config()
        return {'version': '0.1.16', 'workspace': str(root), 'python': cfg.get('python', sys.executable)}
    if action == 'configure_python':
        candidate = Path(str(message.get('python', '')).strip().strip('"'))
        if not candidate.is_absolute() or not candidate.is_file():
            raise ValueError('请选择 Python 环境中实际存在的 python.exe 完整路径')
        if not re.fullmatch(r'python(?:[0-9.]*)?(?:\.exe)?', candidate.name, re.I):
            raise ValueError('需要 Python 可执行文件路径，不是 PyTorch 包目录')
        check = run_capture([str(candidate), '-c',
            "import sys,json,importlib.util;print(json.dumps({'python':sys.executable,'torch_installed':bool(importlib.util.find_spec('torch'))}))"], timeout=10)
        if check.get('exit_code') != 0:
            raise ValueError('Python 环境验证失败：' + check.get('error', check.get('stderr', '')))
        info = json.loads(check['stdout'].strip().splitlines()[-1])
        cfg, _ = config()
        cfg['python'] = str(candidate.resolve())
        atomic_json(DATA / 'config.json', cfg)
        return {'python': cfg['python'], 'torch_installed': info['torch_installed']}
    if action and action.startswith('upload_'):
        return upload(message)
    if action != 'execute':
        raise ValueError('未知宿主动作')
    request = message['request']
    if request.get('protocol') != 'chatx/1' or not re.fullmatch(r'[0-9a-f]{32}', request.get('session', '')):
        raise ValueError('协议或 session 无效')
    if not re.fullmatch(r'[a-zA-Z0-9_-]{1,80}', request.get('id', '')):
        raise ValueError('请求 id 无效')
    if not isinstance(request.get('args'), dict):
        raise ValueError('args 无效')
    if request.get('tool') in ('system_info', 'list_files', 'read_file', 'job_status', 'list_jobs'):
        # Queries have no side effects; do not fill the request journal with poll log snapshots.
        return {'ok': True, 'result': execute(request['tool'], request['args'])}
    canonical = json.dumps(request, sort_keys=True, ensure_ascii=False).encode()
    cache_key = hashlib.sha256((request['session'] + ':' + request['id']).encode()).hexdigest()
    record = DATA / 'requests' / (cache_key + '.json')
    record.parent.mkdir(parents=True, exist_ok=True)
    digest = hashlib.sha256(canonical).hexdigest()
    # Exclusive reservation before execution gives at-most-once behavior across native host processes.
    try:
        with record.open('x', encoding='utf-8') as stream:
            json.dump({'digest': digest, 'state': 'pending'}, stream)
    except FileExistsError:
        existing = read_json(record)
        if existing['digest'] != digest:
            raise ValueError('同一 id 的参数已改变，请使用新 id')
        if existing['state'] != 'complete':
            raise ValueError('请求已被接收但结果未确认；不会自动重放，请检查本地状态')
        return {**existing['response'], 'replayed': True}
    try:
        result = {'ok': True, 'result': execute(request['tool'], request['args'])}
    except Exception as exc:
        result = {'ok': False, 'error': str(exc)}
    atomic_json(record, {'digest': digest, 'state': 'complete', 'response': result})
    return result


def read_exact(stream, length):
    data = b''
    while len(data) < length:
        chunk = stream.read(length-len(data))
        if not chunk:
            raise EOFError('Incomplete native frame')
        data += chunk
    return data


def main():
    if os.name == 'nt':
        import msvcrt
        msvcrt.setmode(sys.stdin.fileno(), os.O_BINARY)
        msvcrt.setmode(sys.stdout.fileno(), os.O_BINARY)
    try:
        size = struct.unpack('<I', read_exact(sys.stdin.buffer, 4))[0]
        if size > 2*1024*1024:
            raise ValueError('Native message too large')
        result = handle(json.loads(read_exact(sys.stdin.buffer, size)))
        if not (isinstance(result, dict) and 'ok' in result):
            result = {'ok': True, 'result': result}
    except Exception as exc:
        result = {'ok': False, 'error': str(exc)}
    output = json.dumps(result, ensure_ascii=False).encode('utf-8')
    sys.stdout.buffer.write(struct.pack('<I', len(output)) + output)
    sys.stdout.buffer.flush()


if __name__ == '__main__':
    main()
