# Chatx

让网页版的 ChatGPT 调用你电脑上的 Python、终端、文件和 GPU 资源。

支持 Windows 的 Chrome 和 Edge。

## 安装

1. 安装 Python 3.10 或更新版本。
2. 到 [Releases](https://github.com/Casheep/Chatx/releases/latest) 下载 `Chatx-0.1.16-Windows.zip`，解压到固定目录。
3. 打开 `chrome://extensions/` 或 `edge://extensions/`，开启开发者模式，选择“加载已解压的扩展程序”，选中解压后的 `extension` 文件夹。
4. 双击 `install.cmd`，按提示注册本机执行程序，无需管理员权限。
5. 刷新 ChatGPT 网页，在 Chat 模式下点击右下角 Chatx 的“已关闭”开关启用。

安装后不要移动文件夹；移动后需重新注册。更新时可覆盖原目录的程序文件，保留本机配置，再重新加载扩展并刷新网页。

## 使用

- 开启后自动执行本机任务并回传结果，无需逐条确认；点击“已开启”可关闭并请求取消当前任务。
- 在小框里填写已有 Python 环境的 `python.exe` 路径，按回车保存。GPU 计算需要该环境已经安装可用的 PyTorch 等计算库。
- 默认工作目录为 `local-workspace`。把文件放进去，再告诉 Chat 文件的相对路径。
- 遇到连接中断或结果未回传，可展开小框点击“恢复连接”。

例如，向 Chat 发送：

> 请通过 Chatx 在我的本机计算 1 到 1000000 的平方和，保存结果文件，再实际读取并核对。

## 卸载

先关闭插件，运行 `scripts/uninstall.ps1`，再从浏览器移除扩展。本机任务记录和用户文件会保留。

