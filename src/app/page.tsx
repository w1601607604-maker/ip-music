'use client'

import { useState, useCallback, useRef } from 'react'
import type { WorkItem, MusicItem, LyricResult, SongItem } from '@/lib/types'
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

  // 第一步：网易云曲目列表
  const [songs, setSongs] = useState<SongItem[]>([])
  const [loadingSongs, setLoadingSongs] = useState(false)
  const [songsError, setSongsError] = useState('')

  // 第二步：当前选中的曲目 + 它的 B站播放源
  const [activeSong, setActiveSong] = useState<SongItem | null>(null)
  const [music, setMusic] = useState<MusicItem[]>([])
  const [loadingMusic, setLoadingMusic] = useState(false)
  const [musicError, setMusicError] = useState('')

  // 播放
  const [playing, setPlaying] = useState<MusicItem | null>(null)

  // 歌词（直接由网易云曲目 id 获取，不再靠关键词猜）
  const [lyric, setLyric] = useState<LyricResult | null>(null)
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

  /** 点击作品 → 第一步：从网易云拉取曲目列表 */
  const openWork = useCallback(async (work: WorkItem) => {
    setActiveWork(work)
    setSongs([])
    setSongsError('')
    setActiveSong(null)
    setMusic([])
    setMusicError('')
    setPlaying(null)
    setLyric(null)
    setLoadingSongs(true)

    // 滚动到详情区
    setTimeout(
      () => detailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
      100,
    )

    try {
      const res = await fetch(
        `/api/netease/songs?name=${encodeURIComponent(work.name)}`,
      )
      const json = await res.json()

      if (!res.ok) {
        setSongsError(json.error || '搜索失败')
        return
      }
      setSongs(json.data)
    } catch {
      setSongsError('网络错误，请稍后重试')
    } finally {
      setLoadingSongs(false)
    }
  }, [])

  /**
   * 点击曲目 → 第二步：搜索 B站播放源 + 拉取歌词。
   *
   * B站请求只在这里触发（用户主动点击），请求量极低。
   */
  const openSong = useCallback(
    async (song: SongItem) => {
      // 再次点击同一首 → 收起
      if (activeSong?.id === song.id) {
        setActiveSong(null)
        setMusic([])
        setPlaying(null)
        setLyric(null)
        return
      }

      setActiveSong(song)
      setMusic([])
      setMusicError('')
      setPlaying(null)
      setLyric(null)
      setLoadingMusic(true)
      setLoadingLyric(true)

      // 歌词与播放源并行请求
      const lyricPromise = fetch(`/api/music/lyric?id=${song.id}`)
        .then((r) => r.json())
        .then((j) =>
          setLyric(
            j && !j.error
              ? j
              : {
                  found: false,
                  lines: [],
                  hasTranslation: false,
                  message: j?.error || '歌词加载失败',
                },
          ),
        )
        .catch(() =>
          setLyric({
            found: false,
            lines: [],
            hasTranslation: false,
            message: '网络错误',
          }),
        )
        .finally(() => setLoadingLyric(false))

      const musicPromise = fetch(
        `/api/music/search?song=${encodeURIComponent(song.name)}&artist=${encodeURIComponent(song.artist)}`,
      )
        .then((r) => r.json().then((j) => ({ ok: r.ok, j })))
        .then(({ ok, j }) => {
          if (!ok) setMusicError(j.error || '搜索失败')
          else setMusic(j.data)
        })
        .catch(() => setMusicError('网络错误，请稍后重试'))
        .finally(() => setLoadingMusic(false))

      await Promise.all([lyricPromise, musicPromise])
    },
    [activeSong],
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

            {/* 第一步：网易云曲目列表 */}
            <h3 className="mb-3 text-sm font-medium text-slate-300">
              曲目列表
              <span className="ml-2 font-normal text-slate-500">
                {loadingSongs
                  ? '搜索中…'
                  : songs.length > 0
                    ? `${songs.length} 首 · 来自网易云`
                    : ''}
              </span>
            </h3>

            {loadingSongs ? (
              <p className="py-8 text-center text-sm text-slate-500">
                正在从网易云搜索曲目…
              </p>
            ) : songsError ? (
              <p className="rounded-lg bg-red-950/50 px-4 py-3 text-sm text-red-300">
                {songsError}
              </p>
            ) : songs.length === 0 ? (
              <p className="py-8 text-center text-sm text-slate-500">
                网易云未找到该作品的曲目
              </p>
            ) : (
              <ul className="mb-6 max-h-96 space-y-1.5 overflow-y-auto pr-1">
                {songs.map((s) => {
                  const isActive = activeSong?.id === s.id
                  return (
                    <li key={s.id}>
                      <button
                        onClick={() => openSong(s)}
                        className={`flex w-full items-center gap-3 rounded-lg border p-2.5 text-left transition ${
                          isActive
                            ? 'border-bgm bg-slate-800/60'
                            : 'border-slate-800 hover:bg-slate-800/40'
                        }`}
                      >
                        <span
                          className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-xs ${
                            isActive
                              ? 'bg-bgm text-white'
                              : 'bg-slate-800 text-slate-400'
                          }`}
                        >
                          {isActive ? '♪' : '▶'}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm text-slate-200">
                            {s.name}
                            {s.popularity >= 90 && (
                              <span className="ml-1.5 rounded bg-rose-500/20 px-1.5 py-0.5 text-[10px] text-rose-300">
                                热门
                              </span>
                            )}
                          </span>
                          <span className="mt-0.5 block truncate text-xs text-slate-500">
                            {s.artist}
                            {s.album && ` · ${s.album}`}
                          </span>
                        </span>
                        {s.duration > 0 && (
                          <span className="flex-shrink-0 text-xs text-slate-500">
                            {fmtDuration(Math.floor(s.duration / 1000))}
                          </span>
                        )}
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}

            {/* 第二步：选中曲目后的播放源 + 歌词 */}
            {activeSong && (
              <div className="animate-fade-in border-t border-slate-800 pt-5">
                <div className="mb-4 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="truncate text-base font-medium text-slate-100">
                      {activeSong.name}
                    </h3>
                    <p className="mt-0.5 truncate text-xs text-slate-500">
                      {activeSong.artist}
                      {activeSong.album && ` · ${activeSong.album}`}
                    </p>
                  </div>
                  <button
                    onClick={() => {
                      setActiveSong(null)
                      setMusic([])
                      setPlaying(null)
                      setLyric(null)
                    }}
                    className="flex-shrink-0 text-xs text-slate-400 hover:text-white"
                  >
                    收起
                  </button>
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
                <div className="mb-5 rounded-lg border border-slate-800 bg-slate-950/60 p-4">
                  <h3 className="mb-3 text-sm font-medium text-slate-300">
                    歌词与翻译
                  </h3>
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
                            <p className="text-xs text-slate-500">
                              {l.translation}
                            </p>
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

                {/* B站播放源 */}
                <h3 className="mb-3 text-sm font-medium text-slate-300">
                  B站播放源
                  {music.length > 0 && (
                    <span className="ml-2 font-normal text-slate-500">
                      {music.length} 个结果
                    </span>
                  )}
                </h3>

                {loadingMusic ? (
                  <p className="py-6 text-center text-sm text-slate-500">
                    正在搜索 B站播放源…
                  </p>
                ) : musicError ? (
                  <div className="rounded-lg bg-red-950/50 px-4 py-3 text-sm text-red-300">
                    <p className="whitespace-pre-wrap font-mono text-xs leading-relaxed">
                      {musicError}
                    </p>
                    <a
                      href={`https://search.bilibili.com/all?keyword=${encodeURIComponent(
                        `${activeSong.name} ${activeSong.artist}`,
                      )}`}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-2 inline-block rounded border border-red-700 px-3 py-1 text-xs text-red-200 transition hover:bg-red-900/40"
                    >
                      在 B站手动搜索 →
                    </a>
                  </div>
                ) : music.length === 0 ? (
                  <p className="py-6 text-center text-sm text-slate-500">
                    暂无播放源
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
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </section>
        )}
      </div>

      <footer className="mt-12 border-t border-slate-800/60 pt-6 text-center text-xs text-slate-500">
        <p>
          数据来源：Bangumi（收藏）· 网易云（曲目与歌词）· B站（官方播放器）
        </p>
        <p className="mt-1">
          本站不存储任何音频，音乐播放由 B站官方播放器提供
        </p>
      </footer>
    </main>
  )
}
