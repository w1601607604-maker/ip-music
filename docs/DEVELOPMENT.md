# IP-Music 开发日志

> 本文档记录开发过程中的每个阶段、决策、遇到的问题与解决方案。
> 配合 git 提交历史使用，可回溯每个版本做了什么。

## 目录

- [阶段 0：需求调研与可行性验证](#阶段-0需求调研与可行性验证)
- [阶段 1：需求确认](#阶段-1需求确认)
- [阶段 2：项目初始化](#阶段-2项目初始化)
- [阶段 3：后端 API 实现](#阶段-3后端-api-实现)
- [阶段 4：前端实现](#阶段-4前端实现)
- [阶段 5：联调与验证](#阶段-5联调与验证)

---

## 阶段 0：需求调研与可行性验证

**目标**：在写任何代码前，确认技术路线是否可行，避免做到一半发现走不通。

### 0.1 Bangumi API 调研

**结论：完全可行 ✅**

通过官方 OpenAPI 规范（`https://raw.githubusercontent.com/bangumi/api/master/open-api/v0.yaml`）确认：

- 核心接口：`GET /v0/users/{username}/collections`
- 支持参数：
  - `subject_type`：`1`=书籍 `2`=动画 `3`=音乐 `4`=游戏 `6`=三次元（**没有 5**）
  - `type`：收藏状态（想看/在看/看过/搁置/抛弃）
  - `limit`：**最大 50**，默认 30
  - `offset`：分页偏移
- 返回结构：`Paged_UserCollection { total, limit, offset, data: UserSubjectCollection[] }`
- `UserSubjectCollection` 含 `subject` 字段（`SlimSubject`），提供 `id` / `name` / `name_cn` / `images`
- **必须携带 `User-Agent`**，否则可能被拒绝

### 0.2 环境问题发现

**问题**：`api.bgm.tv`、`bgm.tv`、`bangumi.tv` 在开发沙箱中**全部连接超时**。

```
api.bgm.tv       http=000  (Connection timed out)
bgm.tv           http=000
bangumi.tv       http=000
example.com      http=200  ← 说明是这几个域名被限制，非网络故障
```

**影响**：无法在沙箱内联调 Bangumi 接口。

**应对**：严格按 OpenAPI 规范实现，代码完成后由用户在本地环境验证。

### 0.3 网易云方案调研（关键决策点）

这是整个项目最重要的调研，直接决定了架构。

#### 尝试 1：官方第三方 API（NeteaseCloudMusicApi）

**结果：❌ 已因版权原因删库停更**

#### 尝试 2：iframe 外链播放器

**结果：⚠️ 不可靠**

- 页面本身仍返回 HTTP 200
- 但 2025 年起社区大量反馈因跨域 `SecurityError` 无法播放：
  ```
  Uncaught SecurityError: Failed to read a named property 'IgnoreKickout' from 'Window':
  Blocked a frame with origin "https://music.163.com" from accessing a cross-origin frame.
  ```
- 参考：https://global.v2ex.co/t/1124163

#### 尝试 3：匿名获取播放直链

**结果：❌ 大部分拿不到**

实测 8 首歌（`/api/song/enhance/player/url`）：

| 歌曲 ID | code | 能否播放 | 含义 |
|---|---|---|---|
| 22707008 | -110 | ❌ | 需会员 |
| 760533 | -110 | ❌ | 需会员 |
| 22707009 | 200 | ✅ | 可播 |
| 2083842 | 404 | ❌ | 无版权 |
| 5227537 | 404 | ❌ | 无版权 |
| 1330348068 | 200 | ✅ | 可播 |
| 347230 | -110 | ❌ | 需会员 |
| 186016 | 404 | ❌ | 无版权 |

**结论**：匿名直链覆盖率低，且依赖非官方接口。

#### 尝试 4：扫码登录（用户提出）

**用户想法**：扫码登录网易云，账号信息不持久化，用完即弃。

**实测**：
- `GET /api/login/qrcode/unikey?type=1` 返回正常：`{"code":200,"unikey":"..."}`
- 但登录用的 `weapi` 接口要求 `params` + `encSecKey`，是 **AES + RSA 双层加密**，需在服务端重新实现网易云前端加密算法

**更严重的问题：会封号**

据[蓝点网报道](https://www.landian.news/archives/105994.html)，网易云已调整风控：

> 检测到通过第三方 API、网页版模拟登录或第三方脚本使用 Cookies 等方式登录，都会触发风控机制。一旦触发，账号被**临时冻结 3~7 天**，强制登出并要求**重置密码**。

GitHub 上 [SPlayer issue #270](https://github.com/SPlayer-Dev/SPlayer/issues/270) 也有相同警告。

**决策：❌ 放弃扫码登录**

理由：
1. 网站面向公众，每个访客都要交出网易云账号，一旦触发风控是**访客自己的账号被封**
2. 站长在运营"帮人绕过版权限制"的服务，法律与封站风险由站长承担
3. 即使登录，`code=-110`（需会员）的歌依然播不了

### 0.4 替代平台调研

既然网易云无法合规播放，转向调研其他平台。

| 平台 | 站内放全曲 | 合规性 | 实测结果 |
|---|---|---|---|
| **B站** | ✅ **能** | ✅ 官方播放器允许嵌入 | 搜索覆盖极好 |
| iTunes | ⚠️ 仅 30 秒 | ✅ 完全合规 | 100% 有试听，已验证可播放 |
| YouTube | ❌ | — | 沙箱内不可达（http=000） |
| Jamendo | ✅ 全曲 | ✅ CC 授权 | 仅独立音乐，无动漫 |
| Deezer | ❌ | — | 沙箱内不可达（http=000） |
| MusicBrainz | ❌ 仅元数据 | ✅ | 可作元数据源，无播放 |

#### B站方案验证（最终选定）

**1. 官方播放器允许外站嵌入 ✅**

检查 `player.bilibili.com` 响应头，**没有** `X-Frame-Options`，**没有** CSP 限制：

```
HTTP/2 200
（无 x-frame-options / content-security-policy 限制头）
```

这意味着可以合法使用 iframe 嵌入 —— 这是 B站官方提供的分享功能。

**2. 搜索覆盖测试 ✅**

| 关键词 | 结果数 | 最佳结果 |
|---|---|---|
| CLANNAD 主题曲 | 20 | 「CLANNAD ORIGINAL SOUNDTRACK」DISC1/2/3（171分钟） |
| 进击的巨人 OST | 20 | 「1-4季+剧场版，已分P」完整合集 |
| 命运石之门 OP | 20 | 「OP ED 全合集」 |
| 你的名字 主题曲 | 20 | 「无损音质合集」 |
| 原神 音乐 | 20 | 「原神OST 音乐合集（320K）」 |

**3. 风控问题发现 ⚠️**

连续快速请求时返回 `HTTP 412`：

```
塞尔达传说 音乐   [http=412] <!DOCTYPE html>...
```

**应对**：需带完整浏览器请求头（`User-Agent` + `Referer`），控制请求频率，必要时加重试。

### 0.5 歌词接口验证 ✅

用户新增需求：点击歌曲可查看歌词和翻译。

实测 `GET https://music.163.com/api/song/lyric?id=22707009&lv=1&kv=1&tv=-1`：

```json
{
  "code": 200,
  "lrc":    { "lyric": "[00:38.47]遠くで遠くで揺れてる稲穂の海..." },
  "tlyric": { "lyric": "[00:38.47]在那远方 在那远方 如海浪般摇曳着的稻穗..." }
}
```

**原文 + 翻译都有，且无需登录**。歌词属于文本元数据而非版权音频，合规上无问题。

**完整链路验证 ✅**：

```
B站视频标题「小さな手のひら」
  → 网易云搜索 /api/search/get/web?s=小さな手のひら&type=1
  → 命中 id=22707009 (riya)
  → 请求歌词接口
  → 拿到原文 + 翻译
```

### 0.6 阶段总结

**技术路线确定**：

```
Bangumi（作品列表）
    ↓
B站官方播放器（站内放全曲，合规）
    ↓
网易云（歌词+翻译 / 跳转听完整版）
```

**所有技术风险点均已实测排除**，可以进入开发。

---

## 阶段 1：需求确认

### 1.1 用户决策记录

| 议题 | 用户选择 |
|---|---|
| 播放方案 | **B站为主 + 网易云跳转**（用户明确选择"第一个"） |
| 作品类型 | 动画(2) + 游戏(4) + 书籍(1) |
| 匹配策略 | 先用方案 A（作品名搜索），视情况考虑方案 B |
| 技术栈 | 由我推荐 → Next.js |
| 缓存 | 不需要，纯查询即用即走 |
| 部署 | 先本地跑通，部署以后再说 |
| B站内容 | 优先 OST / 音乐合集 |
| 歌词 | **新增需求**：按需加载，点击才请求 |

### 1.2 明确排除项

- 网易云扫码登录（封号风险）
- 抓取网易云音频直链（违规）
- 站内播放网易云完整歌曲（不可行）
- 用户账号体系 / 数据库

### 1.3 产出

- `docs/REQUIREMENTS.md` —— 完整需求文档

---

## 阶段 2：项目初始化

**提交**：`cbd5e98` feat: 项目骨架与后端 API

### 2.1 技术栈落地

- Next.js 14（App Router）
- TypeScript（strict）
- Tailwind CSS
- 包管理器：pnpm

### 2.2 目录结构

```
ip-music/
├── docs/
│   ├── REQUIREMENTS.md      # 需求文档
│   └── DEVELOPMENT.md       # 本文档
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   ├── bangumi/collections/route.ts   # 作品列表
│   │   │   └── music/
│   │   │       ├── search/route.ts            # B站音乐搜索
│   │   │       └── lyric/route.ts             # 网易云歌词
│   │   ├── globals.css
│   │   ├── layout.tsx
│   │   └── page.tsx                            # 主页面
│   └── lib/
│       ├── types.ts        # 共享类型
│       ├── bangumi.ts      # Bangumi API 封装
│       ├── bilibili.ts     # B站搜索封装
│       └── netease.ts      # 网易云歌词封装
├── package.json
├── tsconfig.json
└── tailwind.config.ts
```

### 2.3 遇到的问题

**问题 1：tsconfig 缺少 `target` 导致编译失败**

```
src/lib/netease.ts(68,26): error TS2802: Type 'RegExpStringIterator<RegExpExecArray>'
  can only be iterated through when using the '--downlevelIteration' flag
  or with a '--target' of 'es2015' or higher.
src/lib/netease.ts(166,65): error TS1501: This regular expression flag
  is only available when targeting 'es6' or later.
```

**原因**：LRC 解析用了 `matchAll`（需要 ES2015+ 迭代器）和 Unicode 属性正则 `\p{L}`（需要 ES6+）。

**解决**：在 `tsconfig.json` 加 `"target": "ES2020"`。

**注意**：改完后仍报错，因为 `tsconfig.tsbuildinfo` 缓存了旧配置，删除该文件后才生效。

---

## 阶段 3：后端 API 实现

**提交**：`cbd5e98` feat: 项目骨架与后端 API

### 3.1 Bangumi 模块（`lib/bangumi.ts`）

- 封装 `fetchUserCollections()`
- **强制携带 `User-Agent`**（Bangumi 要求）
- 错误处理：
  - 404 → 用户不存在
  - 网络异常 → 提示可能需要代理
  - 数据格式异常 → 防御性检查
- `toWorkItem()` 归一化：优先中文名，回退原名
- 缓存策略：`revalidate: 300`（5 分钟）

### 3.2 B站模块（`lib/bilibili.ts`）

- 封装 `searchMusic()` 与 `searchMusicForWork()`
- **风控应对**：完整浏览器请求头 + 412 重试（指数退避，最多 3 次）+ 请求间隔 350ms
- **标题清洗** `cleanKeyword()`：去掉画质标签、括号修饰、字幕说明等噪声，提取适合去网易云搜歌的关键词
- **多关键词搜索**：`{作品名} OST` / `音乐合集` / `主题曲`，合并去重

### 3.3 网易云模块（`lib/netease.ts`）

- 只使用**歌词**接口（文本元数据），不涉及版权音频
- `parseLrc()`：解析 LRC 时间轴，支持 `[mm:ss.xx]` 与 `[mm:ss.xxx]` 两种格式
- `mergeTranslation()`：按时间戳对齐原文与翻译
- `findLyric()`：搜索 → 最佳匹配打分 → 拉歌词 → 合并

### 3.4 API 路由

| 路由 | 方法 | 说明 |
|---|---|---|
| `/api/bangumi/collections` | GET | 作品列表，含参数校验 |
| `/api/music/search` | GET | B站音乐搜索，超时 60s |
| `/api/music/lyric` | GET | 歌词，按需调用 |

**参数校验**：用户名限制为 `[A-Za-z0-9_-]{1,32}`，关键词长度限制 100 字符。

---

## 阶段 4：前端实现

**提交**：`e650e10` feat: 前端页面与播放器

### 4.1 页面结构

单页应用，三个区域：

1. **查询区**：用户 ID 输入 + 类型筛选（动画/游戏/书籍）+ 状态筛选（全部/看过/在看/想看/搁置/抛弃）
2. **作品网格**：响应式网格（3~7 列），显示封面 + 名称 + 评分角标
3. **详情面板**：作品信息 + 播放器 + 歌词区 + 音乐列表

### 4.2 关键交互

- 点击作品卡片 → 加载音乐列表 + 平滑滚动到详情区
- 点击音乐条目 → 播放器区域加载 B站 iframe
- 点击"歌词" → 按需请求（**再次点击可折叠**）
- 点击"网易云" → 新标签页跳转搜索页
- 分页："加载更多"按钮（每次 50 条）

### 4.3 遇到的问题（重要）

**问题 2：搜索排序质量差，游戏实况/番剧碾压真实音乐**

首次实现用"合集优先（时长 >= 10 分钟）+ 播放量"排序，实测结果：

```
  85min  治愈催泪神作《CLANNAD》，44集，一口气看完，爆肝18天！   ← 不是音乐
8304min  【最全合集】《CLANNAD》官方中文版全剧情全成就流程        ← 不是音乐
  99min  ［CLANNAD音乐合辑］
 171min  《CLANNAD ORIGINAL SOUNDTRACK》DISC1/2/3
 603min  【英配/720p】CLANNAD～AFTER STORY～ 【合集】【生肉】      ← 不是音乐
```

**原因**：单纯用时长判断"合集"会把游戏实况（8304 分钟）和番剧合集误判为音乐；播放量加权又让爆款实况排到前面。

**解决**：改为**音乐相关性打分** `scoreMusic()`：

| 规则 | 分值 |
|---|---|
| 标题含音乐信号词（OST/原声/主题曲/OP/ED/合集/无损…） | +12 / 个 |
| 标题含噪声词（一口气看完/全剧情/实况/攻略/生肉/预告/MAD…） | **-40** / 个 |
| 时长 10 分钟 ~ 6 小时 | +25 |
| 时长 > 6 小时（基本是番剧/实况） | **-50** |
| 时长 < 10 分钟（单曲） | +5 |
| 播放量 | `log10(play) × 3`（对数加权，避免爆款碾压） |

修复后结果：

```
204min  【GAL】Rewrite OP集&ED集&插入曲&原声集【超高音质】
 34min  【收藏向】秒速五厘米 纯音乐|BGM 合集
183min  【anemoi】OST原声音乐
208min  CLANNAD ORIGINAL SOUNDTRACK 小镇家族 OST 原声带
 99min  ［CLANNAD音乐合辑］
  4min  《CLANNAD》第二季OP片头曲《時を刻む唄》
```

游戏实况与番剧已全部排除，OST 专辑排到最前。

---

## 阶段 5：联调与验证

### 5.1 验证结果

| 测试项 | 结果 |
|---|---|
| `tsc --noEmit` 类型检查 | ✅ 通过 |
| `next build` 生产构建 | ✅ 通过（3 个 API 路由 + 2 个页面） |
| 首页渲染 | ✅ HTTP 200，关键 UI 元素齐全 |
| 音乐搜索 API | ✅ 33 个结果，排序正确 |
| 歌词 API | ✅ 命中正确歌曲，42 行，含中文翻译 |
| B站播放器 URL | ✅ HTTP 200，**无 X-Frame-Options 阻断** |
| 参数校验 | ✅ 空参数 / 非法用户名均返回 400 |
| 空关键词歌词 | ✅ 返回 400 |
| 不存在的歌 | ✅ 优雅降级为"这首歌暂无歌词" |

### 5.2 沙箱环境限制

**Bangumi API 在开发沙箱不可达**：

```
GET /api/bangumi/collections?username=sai
→ HTTP 502 {"error":"无法连接 Bangumi，请检查网络（部分地区可能需要代理）"}
```

这是**预期的**（阶段 0.2 已发现该域名在沙箱被限制），错误提示友好，非代码缺陷。

**需要用户在自己的网络环境验证**：作品列表能否正常拉取。

### 5.3 已知限制

1. **B站搜索较慢**：多关键词串行 + 风控间隔，单次约 6~11 秒
2. **B站搜索可能触发风控**：高频请求返回 412，已做重试但仍可能失败
3. **歌词匹配依赖标题清洗**：B站标题杂乱时可能匹配到错误歌曲
4. **仅 30 秒试听的问题已解决**：改用 B站后可播放完整内容

---

## 阶段 6：后续计划

- [ ] 用户本地验证 Bangumi 数据拉取
- [ ] 部署上线（Vercel）
- [ ] 视匹配效果决定是否启用方案 B（Bangumi 关联音乐条目）
- [ ] 考虑加入轻量缓存减少 API 调用

