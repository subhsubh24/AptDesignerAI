import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';

import { LoginScreen } from '@/components/auth/login-screen';
import { SignupScreen } from '@/components/auth/signup-screen';
import { AUTH_ERROR_CREDENTIALS, AUTH_ERROR_SIGNUP_GENERIC } from '@/lib/auth/auth-errors';

/**
 * Closes the gap named in issue #706: `__tests__/auth/mobile-auth-errors.test.ts`
 * proves the CLASSIFIER functions never leak a provider error string, and a
 * source-text ratchet checks the two auth SCREENS' call sites for the three
 * literal shapes that would bypass the classifier — but the ratchet is a
 * static scan, and two reviewers demonstrated real bypasses no static scan can
 * see (a destructuring shadow, a parameter-default shadow), because it never
 * executes login-screen.tsx / signup-screen.tsx as code. This test does: it
 * renders the actual screens, drives a real sign-in/sign-up failure through
 * the actual Supabase client the screens import, and asserts on what a user
 * would actually SEE — immune to any indirection between the handler and
 * `setError`, because it exercises whatever the call site really resolves to,
 * not a regex over the source text.
 *
 * `fireEvent.*` is ASYNC in @testing-library/react-native v14 (each call
 * wraps a real `act()` flush) — every call below is awaited so the
 * component's state has actually committed before the next interaction reads
 * it or the test asserts on the render output.
 */

const mockSignInWithPassword = jest.fn();
const mockSignUp = jest.fn();

jest.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      signInWithPassword: (...args: unknown[]) => mockSignInWithPassword(...args),
      signUp: (...args: unknown[]) => mockSignUp(...args),
    },
  },
}));

// signup-screen opens Terms/Privacy via the system browser — not under test
// here and not something a jsdom-less RN test environment can render.
jest.mock('expo-web-browser', () => ({
  openBrowserAsync: jest.fn(),
  WebBrowserPresentationStyle: { AUTOMATIC: 'AUTOMATIC' },
}));

// A raw GoTrue error shape. Deliberately includes the exact provider text that
// must NEVER reach the screen — if it renders anywhere, that is the leak this
// guard exists to catch, regardless of which code path produced it.
const PROVIDER_LEAK_TEXT = 'Email not confirmed';
const providerAuthError = {
  message: PROVIDER_LEAK_TEXT,
  code: 'email_not_confirmed',
  status: 400,
  name: 'AuthApiError',
};

describe('LoginScreen — real render, real classifier, no provider text', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('shows the neutral credentials message and NEVER the provider string', async () => {
    mockSignInWithPassword.mockResolvedValue({ error: providerAuthError });

    await render(<LoginScreen onSignup={() => {}} />);

    await fireEvent.changeText(screen.getByLabelText('Email address'), 'someone@example.com');
    await fireEvent.changeText(screen.getByLabelText('Password'), 'wrongpassword');
    await fireEvent.press(screen.getByLabelText('Sign in'));

    await waitFor(() => {
      expect(screen.getByText(AUTH_ERROR_CREDENTIALS)).toBeTruthy();
    });

    // The actual proof: render the whole tree to text and confirm the raw
    // provider string is absent, not just that OUR expected string is present
    // — a screen could render BOTH if a shadow bypassed the classifier for one
    // element while another element still showed the safe message.
    expect(screen.queryByText(PROVIDER_LEAK_TEXT)).toBeNull();
    expect(JSON.stringify(screen.toJSON())).not.toContain(PROVIDER_LEAK_TEXT);
  });

  it('shows the neutral message on a thrown/network failure too, never the raw error', async () => {
    mockSignInWithPassword.mockRejectedValue(new Error('fetch failed: ' + PROVIDER_LEAK_TEXT));

    await render(<LoginScreen onSignup={() => {}} />);

    await fireEvent.changeText(screen.getByLabelText('Email address'), 'someone@example.com');
    await fireEvent.changeText(screen.getByLabelText('Password'), 'whatever123');
    await fireEvent.press(screen.getByLabelText('Sign in'));

    await waitFor(() => {
      expect(screen.queryByText('Signing in…')).toBeNull();
    });

    expect(JSON.stringify(screen.toJSON())).not.toContain(PROVIDER_LEAK_TEXT);
  });
});

describe('SignupScreen — real render, real classifier, no provider text', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('shows the neutral generic signup message and NEVER the provider string', async () => {
    // A non-enumeration failure (e.g. a malformed request the provider
    // rejects for a reason unrelated to whether the address is registered).
    // isAlreadyRegisteredError must be false for this error so the generic
    // branch — the one this test targets — is the one that fires.
    mockSignUp.mockResolvedValue({
      data: { session: null },
      error: { message: PROVIDER_LEAK_TEXT, code: 'weak_password', status: 422, name: 'AuthApiError' },
    });

    await render(<SignupScreen onLogin={() => {}} />);

    await fireEvent.changeText(screen.getByLabelText('Email address'), 'new@example.com');
    await fireEvent.changeText(screen.getByLabelText('Password'), 'longenoughpassword');
    await fireEvent.changeText(screen.getByLabelText('Confirm password'), 'longenoughpassword');
    await fireEvent.press(screen.getByRole('button', { name: 'Create account' }));

    await waitFor(() => {
      expect(screen.getByText(AUTH_ERROR_SIGNUP_GENERIC)).toBeTruthy();
    });

    expect(screen.queryByText(PROVIDER_LEAK_TEXT)).toBeNull();
    expect(JSON.stringify(screen.toJSON())).not.toContain(PROVIDER_LEAK_TEXT);
  });

  it('routes an ALREADY-REGISTERED signup to the same neutral success screen as a new signup — never an error, never the provider text', async () => {
    // The enumeration-critical path: GoTrue says the address is taken, and the
    // screen must show EXACTLY what a brand-new signup shows — no error text
    // of any kind, safe or not, since even a distinct SAFE message would leak
    // "this address already has an account" by its mere presence.
    mockSignUp.mockResolvedValue({
      data: { session: null },
      error: { message: 'User already registered', code: 'user_already_exists', status: 422, name: 'AuthApiError' },
    });

    await render(<SignupScreen onLogin={() => {}} />);

    await fireEvent.changeText(screen.getByLabelText('Email address'), 'existing@example.com');
    await fireEvent.changeText(screen.getByLabelText('Password'), 'longenoughpassword');
    await fireEvent.changeText(screen.getByLabelText('Confirm password'), 'longenoughpassword');
    await fireEvent.press(screen.getByRole('button', { name: 'Create account' }));

    await waitFor(() => {
      expect(screen.getByText('Check your email')).toBeTruthy();
    });

    expect(JSON.stringify(screen.toJSON())).not.toContain('already registered');
    expect(JSON.stringify(screen.toJSON())).not.toContain('already exists');
  });
});
