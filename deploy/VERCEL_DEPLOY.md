# Vercel 部署说明

## 1. 先准备

需要先有一个 Vercel 账号，并在本机登录：

```powershell
vercel login
```

登录后在项目根目录执行：

```powershell
vercel pull --yes
```

这一步会把项目和 Vercel 绑定，并生成本地项目配置。

## 2. 配置环境变量

建议至少配置这些：

- `ROOM_STORE_MODE=upstash`
- `ROOM_STORE_KEY=ruian-mahjong:rooms`
- `UPSTASH_REDIS_REST_URL=...`
- `UPSTASH_REDIS_REST_TOKEN=...`
- `METERED_TURN_APP=...`
- `METERED_TURN_API_KEY=...`

可以参考：

```text
deploy/vercel.env.example
```

在 Vercel 后台或命令行都可以配置，例如：

```powershell
vercel env add ROOM_STORE_MODE production
vercel env add ROOM_STORE_KEY production
vercel env add UPSTASH_REDIS_REST_URL production
vercel env add UPSTASH_REDIS_REST_TOKEN production
vercel env add METERED_TURN_APP production
vercel env add METERED_TURN_API_KEY production
```

## 3. 预览部署

```powershell
npm run vercel:deploy
```

## 4. 正式部署

```powershell
npm run vercel:deploy:prod
```

## 5. 当前部署结构

- `server.js` 作为统一入口
- `public/` 仍由 Express 提供页面和静态资源
- 房间快照默认在 Vercel 上走 Upstash Redis
- Socket.IO 在线上优先走 `websocket`，避免轮询会话漂移

## 6. 注意

如果没有配置 Upstash，Vercel 实例切换后房间状态不能稳定保留。

如果没有配置 TURN，摄像头/麦克风在不同网络环境下可能会出现打洞失败。
