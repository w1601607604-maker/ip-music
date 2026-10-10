# IP-Music

输入 Bangumi 用户 ID，收听你收藏作品的相关音乐。

## 功能

- 🔍 输入 Bangumi 用户 ID，查看已看过/玩过/读过的作品（封面 + 名称）
- 🎵 点击作品，自动找到相关音乐（优先 OST / 音乐合集）
- ▶️ 站内播放（B站官方播放器，可听完整内容）
- 📝 按需查看歌词与中文翻译（来自网易云）
- 🔗 一键跳转网易云搜索

## 快速开始

```bash
pnpm install
pnpm dev
```

打开 http://localhost:3000

## 技术栈

- Next.js 14（App Router）
- TypeScript
- Tailwind CSS

## 数据来源

| 用途 | 来源 | 说明 |
|---|---|---|
| 作品列表 | [Bangumi API](https://github.com/bangumi/api) | 官方公开 API |
| 音乐搜索 | B站 web 接口 | 非官方接口，有风控 |
| 音乐播放 | B站官方 iframe 播放器 | 合规嵌入 |
| 歌词翻译 | 网易云歌词接口 | 仅文本元数据 |

## 合规说明

本站**不存储、不转码、不代理**任何音频内容：

- 音乐播放使用 B站**官方播放器**，播放行为发生在 B站内，播放量归属 B站
- 歌词仅使用网易云的**文本元数据**接口，不涉及版权音频
- **不使用**网易云扫码登录，**不抓取**网易云音频直链

详见 [需求文档](docs/REQUIREMENTS.md) 中的方案选型过程。

## 文档

- [需求文档](docs/REQUIREMENTS.md) —— 功能范围、技术方案、验收标准
- [开发日志](docs/DEVELOPMENT.md) —— 开发过程、决策记录、问题排查

## 已知限制

- B站搜索单次约 6~11 秒（多关键词串行 + 风控间隔）
- B站接口有风控，高频请求可能失败（已做重试）

## 连不上 Bangumi？

访问 `/api/diagnose` 可一键诊断，或在页面查询失败时点击「运行网络诊断」按钮。

常见原因是 **DNS 污染**：`api.bgm.tv` 被解析到了 Dropbox/Facebook 的 IP 段。检查方法：

```bash
nslookup api.bgm.tv
# 正常应返回 Bangumi 的 IP
# 若返回 162.125.* / 108.160.*（Dropbox）或 69.63.* / 31.13.*（Facebook），即为污染
```

解决办法：更换 DNS（`223.5.5.5` 阿里 / `119.29.29.29` 腾讯）或使用代理。

也可用环境变量指定 API 基址：

```bash
BANGUMI_API_BASE=https://api.bgm.tv pnpm dev
```
