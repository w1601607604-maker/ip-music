'use client'

import { useState, useCallback, useRef } from 'react'
import type { WorkItem, MusicItem, LyricResult } from '@/lib/types'
import { SUBJECT_TYPE_LABEL, COLLECTION_TYPE_LABEL } from '@/lib/types'

const SUBJECT_TYPES = [
  { value: 2, label: '动画' },
  { value: 4, label: '游戏' },
  { value: 1, label: '书籍' },
]

const COLLECTION_TYPES = [
  { value: 0, label: '全部' },
  { value: 2, label: '看过' },
  { value: 3, label: '在看' },
  { value: 1, label: '想看' },
  { value: 4, label: '搁置' },
  { value: 5, label: '抛弃' },
]

const PAGE_SIZE = 50

/** 秒 → mm:ss / h:mm:ss */
function fmtDuration(sec: number): string {
  if (!sec) return ''
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = sec % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`
}

/** 播放量 → 万/亿 */
function fmtPlay(n: number): string {
  if (n >= 100000000) return `${(n / 100000000).toFixed(1)}亿`
  if (n >= 10000) return `${(n / 10000).toFixed(1)}万`
  return String(n)
}

export default function Home() {
  // 查询条件
  const [username, setUsername] = useState('')
  const [subjectType, setSubjectType] = useState(2)
  const [collectionType, setCollectionType] = useState(0)

  // 作品列表
  const [works, setWorks] = useState<WorkItem[]>([])
  const [total, setTotal] = useState(0)
  const [offset, setOffset] = useState(0)
  const [loadingWorks, setLoadingWorks] = useState(false)
  const [worksError, setWorksError] = useState('')

  // 当前选中的作品
  const [activeWork, setActiveWork] = useState<WorkItem | null>(null)

  // 音乐列表
  const [music, setMusic] = useState<MusicItem[]>([])
  const [loadingMusic, setLoadingMusic] = useState(false)
  const [musicError, setMusicError] = useState('')

  // 播放
  const [playing, setPlaying] = useState<MusicItem | null>(null)

  // 歌词
  const [lyric, setLyric] = useState<LyricResult | null>(null)
  const [lyricFor, setLyricFor] = useState<string>('')
  const [loadingLyric, setLoadingLyric] = useState(false)

  const detailRef = useRef<HTMLDivElement>(null)

  /** 拉取作品列表 */
  const loadWorks = useCallback(
    async (nextOffset = 0, append = false) => {
      const u = username.trim()
      if (!u) {
        setWorksError('请输入 Bangumi 用户 ID')
        return
      }

      setLoadingWorks(true)
      setWorksError('')

      try {
        const params = new URLSearchParams({
          username: u,
          subjectType: String(subjectType),
          limit: String(PAGE_SIZE),
          offset: String(nextOffset),
        })
        if (collectionType) params.set('type', String(collectionType))

        const res = await fetch(`/api/bangumi/collections?${params}`)
        const json = await res.json()

        if (!res.ok) {
          setWorksError(json.error || '查询失败')
          if (!append) setWorks([])
          return
        }

        setWorks((prev) => (append ? [...prev, ...json.data] : json.data))
        setTotal(json.total)
        setOffset(nextOffset)
      } catch {
        setWorksError('网络错误，请稍后重试')
      } finally {
        setLoadingWorks(false)
      }
    },
    [username, subjectType, collectionType],
  )

  /** 点击作品 → 加载音乐 */
  const openWork = useCallback(async (work: WorkItem) => {
    setActiveWork(work)
    setMusic([])
    setMusicError('')
    setPlaying(null)
    setLyric(null)
    setLyricFor('')
    setLoadingMusic(true)

    // 滚动到详情区
    setTimeout(
      () => detailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
      100,
    )

    try {
      const res = await fetch(
        `/api/music/search?name=${encodeURIComponent(work.name)}`,
      )
      const json = await res.json()

      if (!res.ok) {
        setMusicError(json.error || '搜索失败')
        return
      }
      setMusic(json.data)
    } catch {
      setMusicError('网络错误，请稍后重试')
    } finally {
      setLoadingMusic(false)
    }
  }, [])

  /** 按需加载歌词 */
  const loadLyric = useCallback(
    async (item: MusicItem) => {
      // 已加载过则折叠
      if (lyricFor === item.bvid) {
        setLyric(null)
        setLyricFor('')
        return
      }

      setLyricFor(item.bvid)
      setLyric(null)
      setLoadingLyric(true)

      try {
        const res = await fetch(
          `/api/music/lyric?keyword=${encodeURIComponent(item.keyword)}`,
        )
        const json = await res.json()
        setLyric(res.ok ? json : { found: false, lines: [], hasTranslation: false, message: json.error })
      } catch {
        setLyric({
          found: false,
          lines: [],
          hasTranslation: false,
          message: '网络错误',
        })
      } finally {
        setLoadingLyric(false)
      }
    },
    [lyricFor],
  )

  const hasMore = works.length < total

  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      {/* 标题 */}
      <header className="mb-8 text-center">
        <h1 className="title-gradient text-4xl font-bold tracking-tight sm:text-5xl">
          IP-Music
        </h1>
        <p className="mt-3 text-sm text-slate-400">
          输入 Bangumi 用户 ID，收听你收藏作品的相关音乐
        </p>
      </header>

      {/* 查询区 */}
      <section className="glass mb-8 rounded-2xl p-4 shadow-xl sm:p-6">
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-3 sm:flex-row">
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && loadWorks(0)}
              placeholder="Bangumi 用户 ID，例如 sai"
              className="flex-1 rounded-lg border border-slate-700/60 bg-slate-950/70 px-4 py-2.5 text-sm outline-none transition focus:border-bgm focus:ring-2 focus:ring-bgm/30"
            />
            <button
              onClick={() => loadWorks(0)}
              disabled={loadingWorks}
              className="rounded-lg bg-gradient-to-r from-bgm to-rose-400 px-6 py-2.5 text-sm font-medium text-white shadow-lg shadow-bgm/20 transition hover:brightness-110 disabled:opacity-50"
            >
              {loadingWorks ? '查询中…' : '查询'}
            </button>
          </div>

          {/* 筛选 */}
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3 text-sm">
            <div className="flex items-center gap-2">
              <span className="text-slate-400">类型</span>
              <div className="flex gap-1">
                {SUBJECT_TYPES.map((t) => (
                  <button
                    key={t.value}
                    onClick={() => setSubjectType(t.value)}
                    className={`rounded-md px-3 py-1 transition ${
                      subjectType === t.value
                        ? 'bg-bgm text-white'
                        : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-slate-400">状态</span>
              <div className="flex flex-wrap gap-1">
                {COLLECTION_TYPES.map((t) => (
                  <button
                    key={t.value}
                    onClick={() => setCollectionType(t.value)}
                    className={`rounded-md px-3 py-1 transition ${
                      collectionType === t.value
                        ? 'bg-bgm text-white'
                        : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {worksError && (
          <div className="mt-4 rounded-lg bg-red-950/50 px-4 py-2.5 text-sm text-red-300">
            <p className="whitespace-pre-wrap font-mono text-xs leading-relaxed">
              {worksError}
            </p>
            <button
              onClick={async () => {
                try {
                  const r = await fetch('/api/diagnose')
                  const d = await r.json()
                  setWorksError(
                    `${worksError}\n\n【诊断结果】\n${d.verdict}\n` +
                      `DNS: ${JSON.stringify(d.dns)}\n` +
                      `HTTP: ${JSON.stringify(d.http)}`,
                  )
                } catch {
                  setWorksError(`${worksError}\n\n诊断请求失败`)
                }
              }}
              className="mt-2 rounded border border-red-700 px-3 py-1 text-xs text-red-200 transition hover:bg-red-900/40"
            >
              运行网络诊断
            </button>
          </div>
        )}
      </section>

      {/* 作品列表 */}
      {works.length > 0 && (
        <section className="mb-8">
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="text-lg font-semibold">
              作品列表
              <span className="ml-2 text-sm font-normal text-slate-400">
                共 {total} 部
              </span>
            </h2>
          </div>

          <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-7">
            {works.map((w) => (
              <button
                key={w.id}
                onClick={() => openWork(w)}
                title={w.name}
                className={`group text-left transition ${
                  activeWork?.id === w.id ? 'ring-2 ring-bgm rounded-lg' : ''
                }`}
              >
                <div className="work-card relative aspect-[3/4] overflow-hidden rounded-lg bg-slate-800 ring-1 ring-white/5">
                  {w.cover ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={w.cover}
                      alt={w.name}
                      loading="lazy"
                      className="h-full w-full object-cover transition group-hover:scale-105"
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center text-xs text-slate-500">
                      无封面
                    </div>
                  )}
                  {w.rate > 0 && (
                    <span className="absolute right-1 top-1 rounded bg-black/70 px-1.5 py-0.5 text-[10px] text-amber-300">
                      {w.rate}
                    </span>
                  )}
                </div>
                <p className="mt-1.5 line-clamp-2 text-xs leading-snug text-slate-300 group-hover:text-white">
                  {w.name}
                </p>
              </button>
            ))}
          </div>

          {hasMore && (
            <div className="mt-6 text-center">
              <button
                onClick={() => loadWorks(offset + PAGE_SIZE, true)}
                disabled={loadingWorks}
                className="rounded-lg border border-slate-700/60 bg-slate-900/40 px-6 py-2 text-sm text-slate-300 backdrop-blur transition hover:border-bgm/50 hover:bg-slate-800/60 disabled:opacity-50"
              >
                {loadingWorks ? '加载中…' : `加载更多（还有 ${total - works.length} 部）`}
              </button>
            </div>
          )}
        </section>
      )}

      {/* 详情区 */}
      <div ref={detailRef}>
        {activeWork && (
          <section className="glass animate-fade-in rounded-2xl p-4 shadow-xl sm:p-6">
            <div className="mb-5 flex items-start gap-4">
              {activeWork.cover && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={activeWork.cover}
                  alt={activeWork.name}
                  className="h-24 w-18 flex-shrink-0 rounded-lg object-cover"
                  style={{ width: '4.5rem' }}
                />
              )}
              <div className="min-w-0 flex-1">
                <h2 className="truncate text-xl font-semibold">{activeWork.name}</h2>
                <p className="mt-1 text-sm text-slate-400">
                  {SUBJECT_TYPE_LABEL[activeWork.subjectType]} ·{' '}
                  {COLLECTION_TYPE_LABEL[activeWork.collectionType]}
                  {activeWork.rate > 0 && ` · 评分 ${activeWork.rate}`}
                </p>
                <a
                  href={`https://bgm.tv/subject/${activeWork.id}`}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-1 inline-block text-xs text-bgm hover:underline"
                >
                  在 Bangumi 查看 →
                </a>
              </div>
            </div>

            {/* 播放器 */}
            {playing && (
              <div className="mb-5">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <p className="truncate text-sm text-slate-300">
                    正在播放：{playing.title}
                  </p>
                  <button
                    onClick={() => setPlaying(null)}
                    className="flex-shrink-0 text-xs text-slate-400 hover:text-white"
                  >
                    关闭
                  </button>
                </div>
                <div className="aspect-video w-full overflow-hidden rounded-lg bg-black">
                  <iframe
                    src={`https://player.bilibili.com/player.html?bvid=${playing.bvid}&page=1&autoplay=1&high_quality=1&danmaku=0`}
                    className="h-full w-full"
                    scrolling="no"
                    frameBorder="0"
                    allowFullScreen
                    title={playing.title}
                  />
                </div>
              </div>
            )}

            {/* 歌词 */}
            {lyricFor && (
              <div className="mb-5 rounded-lg border border-slate-800 bg-slate-950/60 p-4">
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="text-sm font-medium text-slate-300">
                    歌词
                    {lyric?.song && (
                      <span className="ml-2 font-normal text-slate-500">
                        {lyric.song.name} — {lyric.song.artist}
                      </span>
                    )}
                  </h3>
                  <button
                    onClick={() => {
                      setLyric(null)
                      setLyricFor('')
                    }}
                    className="text-xs text-slate-400 hover:text-white"
                  >
                    收起
                  </button>
                </div>

                {loadingLyric ? (
                  <p className="py-4 text-center text-sm text-slate-500">
                    歌词加载中…
                  </p>
                ) : lyric && lyric.lines.length > 0 ? (
                  <div className="lyric-scroll max-h-80 overflow-y-auto pr-2">
                    {lyric.lines.map((l, i) => (
                      <div key={i} className="mb-2 leading-relaxed">
                        <p className="text-sm text-slate-200">{l.text}</p>
                        {l.translation && (
                          <p className="text-xs text-slate-500">{l.translation}</p>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="py-4 text-center text-sm text-slate-500">
                    {lyric?.message || '暂无歌词'}
                  </p>
                )}
              </div>
            )}

            {/* 音乐列表 */}
            <h3 className="mb-3 text-sm font-medium text-slate-300">
              相关音乐
              {music.length > 0 && (
                <span className="ml-2 font-normal text-slate-500">
                  {music.length} 个结果
                </span>
              )}
            </h3>

            {loadingMusic ? (
              <p className="py-8 text-center text-sm text-slate-500">
                正在搜索 B站音乐…
              </p>
            ) : musicError ? (
              <p className="rounded-lg bg-red-950/50 px-4 py-3 text-sm text-red-300">
                {musicError}
              </p>
            ) : music.length === 0 ? (
              <p className="py-8 text-center text-sm text-slate-500">
                暂无结果
              </p>
            ) : (
              <ul className="space-y-2">
                {music.map((m) => (
                  <li
                    key={m.bvid}
                    className={`flex items-center gap-3 rounded-lg border p-2.5 transition ${
                      playing?.bvid === m.bvid
                        ? 'border-bgm bg-slate-800/60'
                        : 'border-slate-800 hover:bg-slate-800/40'
                    }`}
                  >
                    <button
                      onClick={() => setPlaying(m)}
                      className="flex min-w-0 flex-1 items-center gap-3 text-left"
                    >
                      <div className="relative h-12 w-20 flex-shrink-0 overflow-hidden rounded bg-slate-800">
                        {m.cover ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={m.cover}
                            alt=""
                            loading="lazy"
                            className="h-full w-full object-cover"
                          />
                        ) : null}
                        <span className="absolute inset-0 flex items-center justify-center bg-black/30 text-lg">
                          ▶
                        </span>
                        {m.duration > 0 && (
                          <span className="absolute bottom-0.5 right-0.5 rounded bg-black/80 px-1 text-[10px] text-white">
                            {fmtDuration(m.duration)}
                          </span>
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="line-clamp-2 text-sm text-slate-200">
                          {m.title}
                        </p>
                        <p className="mt-0.5 truncate text-xs text-slate-500">
                          {m.author}
                          {m.play > 0 && ` · ${fmtPlay(m.play)} 播放`}
                        </p>
                      </div>
                    </button>

                    <div className="flex flex-shrink-0 flex-col gap-1 sm:flex-row">
                      <button
                        onClick={() => loadLyric(m)}
                        className={`rounded px-2.5 py-1 text-xs transition ${
                          lyricFor === m.bvid
                            ? 'bg-bgm text-white'
                            : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                        }`}
                      >
                        歌词
                      </button>
                      <a
                        href={`https://music.163.com/#/search/m/?s=${encodeURIComponent(m.keyword)}`}
                        target="_blank"
                        rel="noreferrer"
                        className="rounded bg-slate-800 px-2.5 py-1 text-center text-xs text-slate-300 transition hover:bg-slate-700"
                      >
                        网易云
                      </a>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </div>

      <footer className="mt-12 border-t border-slate-800/60 pt-6 text-center text-xs text-slate-500">
        <p>
          数据来源：Bangumi · B站（官方播放器）· 网易云（歌词）
        </p>
        <p className="mt-1">
          本站不存储任何音频，音乐播放由 B站官方播放器提供
        </p>
      </footer>
    </main>
  )
}
