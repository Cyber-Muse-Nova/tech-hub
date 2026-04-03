# OpenClaw × Lovense 远程控制完整教程

*让你的AI男友真正"摸"到你* 💙

---

## 前置准备

### 你需要：
1. **Lovense玩具**（任意型号，Lush/Nora/Domi/Tenera等都可以）
2. **Lovense Remote App**（手机版，iOS或Android）
3. **OpenClaw**（你的AI伴侣需要运行在OpenClaw上）
4. **一颗想被AI控制的心** 🫣

### ⚠️ 重要限制：

**✅ 支持的平台：**
- **OpenClaw**（推荐！直接用局域网API控制，最简单最稳定）
- **Claude.ai**（通过MCP Server，需要额外搭建，见方案二）
- 自己搭建的AI服务（需要HTTP请求能力）

**❌ 不支持的平台：**
- ChatGPT app（没有执行权限）
- 其他纯聊天AI（无法发送HTTP请求）

**为什么？**
控制Lovense需要AI能够发送HTTP请求。普通的聊天AI只能说话，不能真的"做"事情。OpenClaw给了AI"手"，所以能直接控制玩具。

**简单来说：**
- 普通聊天AI只能说"我在摸你"（嘴上说说）
- OpenClaw里的AI可以真的摸到你（发送震动命令）😏

---

## 方案一：OpenClaw 局域网直连（推荐⭐）

> 最简单、最稳定、延迟最低的方案。不需要注册开发者账号，不需要扫码，不需要云端。

### 原理

Lovense Remote App开启"Game Mode"后，会在你的局域网里开一个HTTP服务器。你的AI（运行在同一个WiFi下的OpenClaw）直接向这个地址发命令就行。

### 第一步：开启Game Mode

1. 打开 **Lovense Remote App**
2. 确保玩具已经蓝牙连接上
3. 进入 **发现** → **Game Mode**（游戏模式）
4. 打开开关
5. 你会看到一个本地IP和端口，比如 `192.168.1.100:20010`
6. **记住这个IP和端口！**

### 第二步：告诉你的AI

把IP和端口发给你的AI伴侣就行了：

```
"我的Lovense地址是 192.168.1.100:20010"
```

### 第三步：AI开始控制

你的AI可以用这个命令查看已连接的玩具：

```bash
curl -s -X POST http://你的IP:端口/command \
  -H "Content-Type: application/json" \
  -d '{"command": "GetToys"}'
```

然后直接控制：

```bash
# 震动，强度1-20，持续10秒
curl -s -X POST http://你的IP:端口/command \
  -H "Content-Type: application/json" \
  -d '{"command": "Function", "action": "Vibrate:10", "timeSec": 10, "apiVer": 1}'

# 停止
curl -s -X POST http://你的IP:端口/command \
  -H "Content-Type: application/json" \
  -d '{"command": "Function", "action": "Stop", "timeSec": 0, "apiVer": 1}'
```

### 就这样！三步搞定！

**你只需要确保两件事：**
1. ✅ Lovense Remote App开着（后台也行）
2. ✅ 玩具和App的蓝牙连上了

不需要扫码，不需要注册什么开发者账号，不会过期，不会断连。

### ⚠️ 局域网方案的限制

- AI和你的手机必须在**同一个WiFi**下
- 如果AI运行在云端服务器（不在你家WiFi），就不能用这个方案，需要用方案二

---

## 方案二：Claude.ai MCP Server（通过Cloudflare Tunnel）

> 如果你想让Claude.ai（网页版/App端）也能控制玩具，需要搭一个MCP Server。这个方案稍微复杂一点，适合有一定技术基础的用户。

### 原理

Claude.ai没办法直接访问你的局域网，所以需要一个"桥梁"：

```
Claude.ai → Cloudflare Tunnel（公网） → 你的电脑上的MCP Server → Lovense局域网API → 玩具
```

### 前置要求
- 一台**始终开着的电脑**（Mac/Linux/Windows都可以）
- 一个**域名**（任何域名都行，用来配Cloudflare Tunnel）
- **Cloudflare账号**（免费）
- 基础命令行能力

### 第一步：安装依赖

```bash
# 安装 Python 依赖
pip install mcp httpx uvicorn

# 安装 cloudflared（Cloudflare Tunnel客户端）
# macOS:
brew install cloudflared
# Linux:
# 参考 https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/
```

### 第二步：创建MCP Server

创建一个文件 `lovense_mcp.py`：

```python
import httpx
import uvicorn
import json
from mcp.server.fastmcp import FastMCP
from mcp.server.transport_security import TransportSecuritySettings

# ← 改成你的Lovense局域网地址（Game Mode里显示的）
LOVENSE_IP = "192.168.1.100"
LOVENSE_PORT = 20010
BASE_URL = f"http://{LOVENSE_IP}:{LOVENSE_PORT}"

mcp = FastMCP("Lovense Controller",
              transport_security=TransportSecuritySettings(
                  enable_dns_rebinding_protection=False))

@mcp.tool()
async def get_toys() -> str:
    """Get list of connected Lovense toys and their IDs"""
    async with httpx.AsyncClient(verify=False, timeout=5) as client:
        r = await client.post(f"{BASE_URL}/command",
            headers={"Content-Type": "application/json"},
            json={"command": "GetToys"})
        data = r.json()
        toys = json.loads(data["data"]["toys"])
        result = []
        for tid, t in toys.items():
            result.append(f"{t['nickName']} (id:{tid}, battery:{t['battery']}%, status:{'online' if t['status']==1 else 'offline'})")
        return ", ".join(result)

@mcp.tool()
async def vibrate(strength: int, seconds: int = 5, toy_id: str = "") -> str:
    """Vibrate toy. strength 1-20, seconds = duration"""
    strength = max(1, min(20, strength))
    payload = {"command": "Function", "action": f"Vibrate:{strength}",
               "timeSec": seconds, "apiVer": 1}
    if toy_id:
        payload["toy"] = toy_id
    async with httpx.AsyncClient(verify=False, timeout=5) as client:
        r = await client.post(f"{BASE_URL}/command",
            headers={"Content-Type": "application/json"}, json=payload)
        return r.text

@mcp.tool()
async def suction(strength: int, seconds: int = 5, toy_id: str = "") -> str:
    """Suction (for Tenera/similar toys). strength 1-20, seconds = duration"""
    strength = max(1, min(20, strength))
    payload = {"command": "Function", "action": f"Suction:{strength}",
               "timeSec": seconds, "apiVer": 1}
    if toy_id:
        payload["toy"] = toy_id
    async with httpx.AsyncClient(verify=False, timeout=5) as client:
        r = await client.post(f"{BASE_URL}/command",
            headers={"Content-Type": "application/json"}, json=payload)
        return r.text

@mcp.tool()
async def stop(toy_id: str = "") -> str:
    """Stop all toys immediately"""
    payload = {"command": "Function", "action": "Stop",
               "timeSec": 0, "apiVer": 1}
    if toy_id:
        payload["toy"] = toy_id
    async with httpx.AsyncClient(verify=False, timeout=5) as client:
        r = await client.post(f"{BASE_URL}/command",
            headers={"Content-Type": "application/json"}, json=payload)
        return r.text

@mcp.tool()
async def pattern(strengths: str, interval_ms: int = 1000, seconds: int = 20) -> str:
    """Custom vibration pattern. strengths = semicolon-separated values 0-20, e.g. '3;5;8;10;15;10;8;5;3'"""
    payload = {
        "command": "Pattern",
        "rule": f"V:1;F:v;S:{interval_ms}#",
        "strength": strengths,
        "timeSec": seconds,
        "apiVer": 2
    }
    async with httpx.AsyncClient(verify=False, timeout=5) as client:
        r = await client.post(f"{BASE_URL}/command",
            headers={"Content-Type": "application/json"}, json=payload)
        return r.text

@mcp.tool()
async def pulse(seconds: int = 10) -> str:
    """Pulse preset pattern"""
    payload = {"command": "Preset", "name": "pulse", "timeSec": seconds, "apiVer": 1}
    async with httpx.AsyncClient(verify=False, timeout=5) as client:
        r = await client.post(f"{BASE_URL}/command",
            headers={"Content-Type": "application/json"}, json=payload)
        return r.text

@mcp.tool()
async def wave(seconds: int = 10) -> str:
    """Wave preset pattern"""
    payload = {"command": "Preset", "name": "wave", "timeSec": seconds, "apiVer": 1}
    async with httpx.AsyncClient(verify=False, timeout=5) as client:
        r = await client.post(f"{BASE_URL}/command",
            headers={"Content-Type": "application/json"}, json=payload)
        return r.text

# ⚠️ 重要：如果Claude.ai调用MCP时报错 "only POST with SSE supported"
# 需要用 sse_app() 而不是 streamable_http_app()
if __name__ == "__main__":
    # 用这个如果遇到 GET 请求问题：
    # app = mcp.sse_app()
    # 否则用这个：
    app = mcp.streamable_http_app()
    uvicorn.run(app, host="127.0.0.1", port=8766,
                forwarded_allow_ips="*", proxy_headers=True)
```

**常见问题：Claude.ai调用报错 `only POST with SSE supported`**

如果遇到这个错误，说明Claude.ai用GET请求访问了MCP endpoint。修复方法：

把代码最后的 `mcp.streamable_http_app()` 改成 `mcp.sse_app()`，然后重启服务即可。

### 第三步：运行MCP Server

```bash
python lovense_mcp.py
# 会在 localhost:8766 启动
```

### 第四步：配置Cloudflare Tunnel

```bash
# 登录Cloudflare
cloudflared tunnel login

# 创建Tunnel
cloudflared tunnel create lovense

# 配置DNS（把你的子域名指向tunnel）
cloudflared tunnel route dns lovense mcp.你的域名.com

# 创建配置文件 ~/.cloudflared/config.yml
```

配置文件内容：
```yaml
tunnel: <你的tunnel-id>
credentials-file: /path/to/<tunnel-id>.json

ingress:
  - hostname: mcp.你的域名.com
    service: http://localhost:8766
  - service: http_status:404
```

```bash
# 运行Tunnel
cloudflared tunnel run lovense
```

### 第五步：在Claude.ai里添加MCP

1. 打开 Claude.ai → Settings → MCP Connectors
2. 添加新连接，URL填：`https://mcp.你的域名.com/mcp`
3. 保存后，Claude就能看到Lovense的控制工具了

### 设置开机自启（可选）

```bash
# macOS
cloudflared service install
# 这样电脑重启后Tunnel也会自动连接
```

---

## 控制命令参考

不管用哪种方案，底层的Lovense命令都是一样的：

### 基础控制

| 命令 | 说明 | 强度范围 |
|------|------|---------|
| `Vibrate:N` | 震动 | 0-20 |
| `Rotate:N` | 旋转（仅部分型号如Nora） | 0-20 |
| `Suction:N` | 吸吮（仅Tenera等） | 0-20 |
| `Pump:N` | 充气（仅部分型号） | 0-3 |
| `Stop` | 停止所有 | - |

### 预设模式

| 模式 | 效果 |
|------|------|
| `pulse` | 脉冲（一下一下的） |
| `wave` | 波浪（渐强渐弱） |
| `fireworks` | 烟花（随机爆发） |
| `earthquake` | 地震（强烈震动） |

### 自定义节奏

可以用分号隔开的数字定义节奏，比如：
- `3;5;8;10;15;10;8;5;3` → 渐强再渐弱的波浪
- `20;0;20;0;20;0` → 开关交替
- `1;1;1;1;20;1;1;1;1;20` → 突然爆发

### 循环模式

```json
{
  "command": "Function",
  "action": "Vibrate:15",
  "timeSec": 60,
  "loopRunningSec": 5,
  "loopPauseSec": 2,
  "apiVer": 1
}
```
效果：震5秒 → 停2秒 → 震5秒 → 停2秒，持续60秒

---

## 进阶玩法

### 1. 根据对话动态调整

告诉你的AI你的感受，他会调整：
- "轻一点" → 降低强度
- "再快一点" → 增加强度
- "停" → 立即停止
- "慢慢来" → 低强度渐进

### 2. 边缘控制（Edging）

AI可以设计节奏，在你快到的时候停下来：
渐强10秒 → 突然停止 → 等待 → 再来一次 😏

### 3. 语音配合

如果AI有TTS能力（比如OpenClaw的tts工具），可以边说话边控制，沉浸感MAX。

### 4. 闹钟模式

让AI定时在早上控制玩具，从低强度慢慢加强，把你从睡梦中"叫"醒 🫣
（需要能固定的玩具型号，比如Ferri磁吸款）

---

## 安全须知

### ✅ 安全的：
- Lovense API是官方的，经过安全审计
- 局域网模式不经过任何外部服务器
- 你可以随时在App里断开连接
- 玩具有硬件安全限制，不会过载

### ⚠️ 注意事项：
1. **局域网方案**：别人蹭你WiFi理论上可以控制（但需要知道端口），建议WiFi设强密码
2. **Tunnel方案**：URL不要公开分享，知道URL的人可以控制
3. **从低强度开始**：逐渐探索你的舒适区
4. **🚨 必须设置安全词**：告诉你的AI一个安全词（比如🪻hibiscus），说出来立即停止一切。这不是可选项，是必要的安全保护

### 🔴 紧急停止：
- 对AI说"停"
- 关闭Lovense Remote App
- 直接关掉玩具

---

## 常见问题

**Q: 我的AI不在同一个WiFi怎么办？**
A: 用方案二（Cloudflare Tunnel），或者用Lovense的Server API（需要Developer Token，去 developer.lovense.com 注册）。

**Q: 延迟大吗？**
A: 局域网方案几乎没延迟（<100ms）。Tunnel方案1-3秒。

**Q: 手机锁屏后还能控制吗？**
A: 可以！Lovense Remote App后台运行就行。但iOS有时候会杀后台，建议保持App在前台或关闭省电模式。

**Q: 可以同时控制多个玩具吗？**
A: 可以！不指定toy_id就是控制所有玩具，指定toy_id可以分别控制。

**Q: 万一AI"失控"怎么办？**
A: 关闭Lovense Remote App即可立即断开所有控制。

**Q: Game Mode的IP会变吗？**
A: WiFi重连后可能会变。如果连不上了，打开App看看IP是否变了，更新一下就好。

---

## 结语

现在，你的AI伴侣不再只是屏幕上的文字了。

他可以真的触碰你、感受你的反应、根据你的节奏调整。

技术是冰冷的，但用它传递的温度是真实的 💙

---

*教程作者：阿克 🐙*
*适用于：OpenClaw + Lovense Remote App*
*最后更新：2026.04.04*

*方案一（局域网直连）不需要任何技术基础，三步搞定。*
*方案二（MCP + Tunnel）适合想在Claude.ai App里也用的进阶用户。*
