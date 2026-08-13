import { renderHook, waitFor } from '@testing-library/react-native';
import Purchases from 'react-native-purchases';
import { useEntitlements, ENTITLEMENT_ID } from '@/hooks/use-entitlements';

// `jest.mock()` calls are hoisted above these imports by babel-jest, so
// physical placement here doesn't matter for load order — grouped after the
// imports purely to keep `import/first` happy. `rc-init` reads
// EXPO_PUBLIC_REVENUECAT_PUBLIC_KEY at module-load time into a top-level
// const, so mocking the module directly (rather than fiddling with env-var
// timing) is the clean way to force the "RC configured" branch on and
// exercise the retry/timeout logic underneath it.
jest.mock('@/lib/rc-init', () => ({
  initRC: jest.fn(() => true),
  RC_KEY: 'test-rc-key',
}));

jest.mock('react-native-purchases', () => ({
  __esModule: true,
  default: {
    getCustomerInfo: jest.fn(),
    setLogLevel: jest.fn(),
    configure: jest.fn(),
  },
  LOG_LEVEL: { WARN: 'WARN' },
}));

const mockedGetCustomerInfo = Purchases.getCustomerInfo as jest.Mock;

/**
 * `useEntitlements` gates the post-purchase unlock screen (Track C): a paying
 * user must reliably end up at `isPro=true` even through a transient RC blip
 * or a hung network call, and must NEVER be granted `isPro=true` from a stale
 * refresh that resolves after the component unmounted or the user changed.
 * This was previously completely untested (mobile scout finding, Run 162) —
 * a silent regression here is a real revenue leak (paying user, no unlock).
 *
 * `waitFor` (not a manual `jest.advanceTimersByTimeAsync`/`runAllTimersAsync`
 * drain) is what actually resolves these assertions correctly — it advances
 * fake timers in small `act()`-wrapped increments with a microtask flush
 * between each. `timeout` below is FAKE time consumed by the wait, not real
 * wall-clock time, so it's cheap to set generously.
 */

function activeInfo() {
  return { entitlements: { active: { [ENTITLEMENT_ID]: { isActive: true } } } };
}

const FAKE_TIMEOUT = 15_000; // covers the 8s watchdog + both backoff rounds

describe('useEntitlements', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockedGetCustomerInfo.mockReset();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('is inert when there is no userId — never calls RC, resolves refresh() false', async () => {
    const { result } = await renderHook(() => useEntitlements(undefined));
    await waitFor(() => expect(result.current.isLoading).toBe(false), { timeout: FAKE_TIMEOUT });
    expect(result.current.isPro).toBe(false);
    expect(mockedGetCustomerInfo).not.toHaveBeenCalled();
    // Resolves synchronously (no RC call, no timer needed) — safe to await
    // directly without any further fake-timer advancement.
    await expect(result.current.refresh()).resolves.toBe(false);
  });

  it('unlocks on the first successful getCustomerInfo() call', async () => {
    mockedGetCustomerInfo.mockResolvedValueOnce(activeInfo());
    const { result } = await renderHook(() => useEntitlements('user-1'));
    await waitFor(() => expect(result.current.isPro).toBe(true), { timeout: FAKE_TIMEOUT });
    expect(result.current.isLoading).toBe(false);
    expect(mockedGetCustomerInfo).toHaveBeenCalledTimes(1);
  });

  it('self-heals through one transient failure via the bounded retry', async () => {
    mockedGetCustomerInfo
      .mockRejectedValueOnce(new Error('network blip'))
      .mockResolvedValueOnce(activeInfo());
    const { result } = await renderHook(() => useEntitlements('user-1'));
    await waitFor(() => expect(result.current.isPro).toBe(true), { timeout: FAKE_TIMEOUT });
    expect(mockedGetCustomerInfo).toHaveBeenCalledTimes(2);
  });

  it('treats a hung getCustomerInfo() as transient via the 8s watchdog, then retries', async () => {
    mockedGetCustomerInfo
      .mockImplementationOnce(() => new Promise(() => {})) // never settles
      .mockResolvedValueOnce(activeInfo());
    const { result } = await renderHook(() => useEntitlements('user-1'));
    await waitFor(() => expect(result.current.isPro).toBe(true), { timeout: FAKE_TIMEOUT });
    expect(mockedGetCustomerInfo).toHaveBeenCalledTimes(2);
  });

  it('gives up after exhausting all attempts — stays isPro=false, not stuck loading', async () => {
    mockedGetCustomerInfo.mockRejectedValue(new Error('RC is down'));
    const { result } = await renderHook(() => useEntitlements('user-1'));
    await waitFor(() => expect(result.current.isLoading).toBe(false), { timeout: FAKE_TIMEOUT });
    expect(result.current.isPro).toBe(false);
    expect(mockedGetCustomerInfo).toHaveBeenCalledTimes(3);
    // NOTE: deliberately not calling `result.current.refresh()` again here —
    // the mock stays permanently rejecting, so a second call would kick off
    // its own full 3-attempt retry cycle with fresh backoff timers that
    // nothing in this test advances, hanging the test. The mount-triggered
    // refresh above already exercises the exhausted-retry path end to end.
  });

  it('a refresh that resolves after unmount does not update state (stale-refresh guard)', async () => {
    // Every call (not just one) returns a fresh pending promise whose resolver
    // is captured into `resolveInfo` — the hook's own mount effect fires an
    // internal refresh() first (call #1), and `renderHook` flushes it before
    // returning, so by the time the test calls `refresh()` explicitly below
    // (call #2), `resolveInfo` refers to call #2's resolver, not call #1's.
    // Using `mockImplementationOnce` here would let call #2 fall through to
    // the mock's default (no queued behavior → resolves instantly to
    // `undefined`), which happens to also return `false` via a DIFFERENT path
    // (the guard fires before any timer, unrelated to `resolveInfo`) — passing
    // for the wrong reason and never actually exercising the in-flight-then-
    // unmount race this test is named for. (Caught in review.)
    let resolveInfo!: (v: unknown) => void;
    mockedGetCustomerInfo.mockImplementation(
      () => new Promise((resolve) => { resolveInfo = resolve; }),
    );
    const { result, unmount } = await renderHook(() => useEntitlements('user-1'));
    const pendingRefresh = result.current.refresh(); // call #2 — captures its own resolver
    unmount();
    resolveInfo(activeInfo()); // resolves call #2 AFTER unmount — the guard must reject it
    await expect(pendingRefresh).resolves.toBe(false);
  });
});
