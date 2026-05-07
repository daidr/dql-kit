import type { Item } from '@dql-kit/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createAsyncOrchestrator, type SearchSlotState } from '../src/asyncOrchestrator.ts'

const mkPatchSink = () => {
  const slot: SearchSlotState = {
    fieldKey: null,
    query: '',
    loading: false,
    error: null,
    results: [],
  }
  const onPatch = (patch: Partial<SearchSlotState>) => {
    Object.assign(slot, patch)
  }
  return { slot, onPatch }
}

describe('asyncOrchestrator — search side', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('debounces rapid setQuery calls into one fetcher invocation with the latest query', async () => {
    const orch = createAsyncOrchestrator()
    const fetcher = vi.fn(async (q: string): Promise<Item[]> => [{ id: q, label: q }])
    const sink = mkPatchSink()

    orch.setQuery('authorId', 'a', fetcher, 250, sink.onPatch)
    orch.setQuery('authorId', 'ab', fetcher, 250, sink.onPatch)
    orch.setQuery('authorId', 'abc', fetcher, 250, sink.onPatch)
    expect(fetcher).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(250)
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(fetcher.mock.calls[0]?.[0]).toBe('abc')
  })

  it('aborts the in-flight fetcher when a newer query arrives', async () => {
    const orch = createAsyncOrchestrator()
    const seenSignals: AbortSignal[] = []
    const fetcher = vi.fn((q: string, signal: AbortSignal): Promise<Item[]> => {
      seenSignals.push(signal)
      return new Promise(() => {})
    })
    const sink = mkPatchSink()

    orch.setQuery('authorId', 'a', fetcher, 0, sink.onPatch)
    expect(seenSignals[0]?.aborted).toBe(false)
    orch.setQuery('authorId', 'b', fetcher, 0, sink.onPatch)
    expect(seenSignals[0]?.aborted).toBe(true)
    expect(seenSignals[1]?.aborted).toBe(false)
  })

  it('drops stale results: a slow first call resolving after a fast second is ignored', async () => {
    const orch = createAsyncOrchestrator()
    let resolveFirst!: (items: Item[]) => void
    const first = new Promise<Item[]>((r) => {
      resolveFirst = r
    })
    let resolveSecond!: (items: Item[]) => void
    const second = new Promise<Item[]>((r) => {
      resolveSecond = r
    })
    const calls: Array<Promise<Item[]>> = [first, second]
    let i = 0
    const fetcher = vi.fn(() => calls[i++]!)
    const sink = mkPatchSink()

    orch.setQuery('authorId', 'a', fetcher, 0, sink.onPatch)
    orch.setQuery('authorId', 'b', fetcher, 0, sink.onPatch)
    resolveSecond([{ id: 2, label: 'second' }])
    await vi.advanceTimersByTimeAsync(0)
    expect(sink.slot.results).toEqual([{ id: 2, label: 'second' }])
    resolveFirst([{ id: 1, label: 'first' }])
    await vi.advanceTimersByTimeAsync(0)
    // Stale resolution does not overwrite the newer one.
    expect(sink.slot.results).toEqual([{ id: 2, label: 'second' }])
  })

  it('sync fetcher fast path: state updates synchronously, no loading flicker', () => {
    const orch = createAsyncOrchestrator()
    const fetcher = (q: string): Item[] => [{ id: q, label: q }]
    const sink = mkPatchSink()

    orch.setQuery('authorId', 'foo', fetcher, 0, sink.onPatch)
    // No timer advance: results already settled.
    expect(sink.slot.loading).toBe(false)
    expect(sink.slot.results).toEqual([{ id: 'foo', label: 'foo' }])
  })

  it('async fetcher rejection populates `error` and clears loading', async () => {
    const orch = createAsyncOrchestrator()
    const boom = new Error('boom')
    const fetcher = vi.fn(async () => {
      throw boom
    })
    const sink = mkPatchSink()

    orch.setQuery('authorId', 'a', fetcher, 0, sink.onPatch)
    await vi.advanceTimersByTimeAsync(0)
    expect(sink.slot.loading).toBe(false)
    expect(sink.slot.error).toBe(boom)
  })
})

describe('asyncOrchestrator — resolve side', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('caches resolve results: a second call for the same id is served from cache', async () => {
    const orch = createAsyncOrchestrator()
    const fetcher = vi.fn(
      async (ids: (string | number)[]): Promise<Item[]> =>
        ids.map((id) => ({ id, label: `L${String(id)}` })),
    )

    orch.resolveBatch('authorId', [1, 2], fetcher)
    await vi.advanceTimersByTimeAsync(0)
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(fetcher.mock.calls[0]?.[0]).toEqual([1, 2])

    // Repeat: nothing new to fetch.
    orch.resolveBatch('authorId', [1, 2], fetcher)
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(orch._peek('authorId', 1)).toEqual({ status: 'resolved', label: 'L1', meta: undefined })
  })

  it('partial overlap re-fetches only the missing ids', async () => {
    const orch = createAsyncOrchestrator()
    const fetcher = vi.fn(
      async (ids: (string | number)[]): Promise<Item[]> =>
        ids.map((id) => ({ id, label: `L${String(id)}` })),
    )

    orch.resolveBatch('authorId', [1, 2], fetcher)
    await vi.advanceTimersByTimeAsync(0)
    orch.resolveBatch('authorId', [2, 3, 4], fetcher)
    await vi.advanceTimersByTimeAsync(0)

    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(fetcher.mock.calls[1]?.[0]).toEqual([3, 4])
  })

  it('partial resolve failure: missing ids surface as { status: "error" }', async () => {
    const orch = createAsyncOrchestrator()
    const fetcher = async (ids: (string | number)[]): Promise<Item[]> =>
      // Returns only id=1; id=2 is "missing" from the response.
      ids.filter((id) => id === 1).map((id) => ({ id, label: `L${String(id)}` }))

    orch.resolveBatch('authorId', [1, 2], fetcher)
    await vi.advanceTimersByTimeAsync(0)

    expect(orch._peek('authorId', 1)).toMatchObject({ status: 'resolved', label: 'L1' })
    expect(orch._peek('authorId', 2)).toEqual({ status: 'error', id: 2 })
  })

  it('full fetcher rejection: every requested id surfaces as error', async () => {
    const orch = createAsyncOrchestrator()
    const fetcher = vi.fn(async () => {
      throw new Error('network')
    })
    orch.resolveBatch('authorId', [1, 2], fetcher)
    await vi.advanceTimersByTimeAsync(0)
    expect(orch._peek('authorId', 1)).toEqual({ status: 'error', id: 1 })
    expect(orch._peek('authorId', 2)).toEqual({ status: 'error', id: 2 })
  })

  it('sync resolve fetcher writes through immediately', () => {
    const orch = createAsyncOrchestrator()
    const fetcher = (ids: (string | number)[]): Item[] =>
      ids.map((id) => ({ id, label: `L${String(id)}` }))
    orch.resolveBatch('authorId', [42], fetcher)
    expect(orch._peek('authorId', 42)).toMatchObject({ status: 'resolved', label: 'L42' })
  })

  it('invalidateLabels(fieldKey?) clears cache scope correctly', async () => {
    const orch = createAsyncOrchestrator()
    const fetcher = async (ids: (string | number)[]): Promise<Item[]> =>
      ids.map((id) => ({ id, label: `L${String(id)}` }))
    orch.resolveBatch('authorId', [1], fetcher)
    orch.resolveBatch('tagId', [99], fetcher)
    await vi.advanceTimersByTimeAsync(0)

    expect(orch._peek('authorId', 1).status).toBe('resolved')
    expect(orch._peek('tagId', 99).status).toBe('resolved')

    orch.invalidateLabels('authorId')
    expect(orch._peek('authorId', 1).status).toBe('pending')
    expect(orch._peek('tagId', 99).status).toBe('resolved')

    orch.invalidateLabels()
    expect(orch._peek('tagId', 99).status).toBe('pending')
  })
})
