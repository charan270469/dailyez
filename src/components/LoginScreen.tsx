// Full-screen sign-in prompt shown after the user logs out (or is not signed in).
// Clicking "Sign in with Google" starts the OAuth consent flow.
export function LoginScreen() {
  const handleSignIn = () => {
    // The Vite dev proxy forwards /auth/google to the backend.
    window.location.href = "/auth/google";
  };

  return (
    <div className="h-screen w-screen bg-[#0a0a0a] text-gray-200 flex items-center justify-center">
      <div className="w-full max-w-md mx-4 text-center">
        <div className="flex justify-center mb-6">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-indigo-500 text-white font-bold text-2xl">
            DE
          </div>
        </div>
        <h1 className="text-3xl font-bold text-white tracking-tight">Welcome back</h1>
        <p className="text-gray-400 mt-3 mb-8">
          Sign in with your Google account to connect Gmail and see everything in
          one inbox.
        </p>

        <button
          onClick={handleSignIn}
          className="w-full flex items-center justify-center gap-3 bg-white text-gray-900 font-semibold py-3 rounded-xl hover:bg-gray-200 transition-colors"
        >
          <svg className="w-5 h-5" viewBox="0 0 24 24" aria-hidden="true">
            <path
              fill="#4285F4"
              d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1z"
            />
            <path
              fill="#34A853"
              d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z"
            />
            <path
              fill="#FBBC05"
              d="M5.84 14.1A6.6 6.6 0 0 1 5.5 12c0-.73.13-1.44.34-2.1V7.06H2.18A11 11 0 0 0 1 12c0 1.78.43 3.46 1.18 4.94l2.52-1.95.14-.1z"
            />
            <path
              fill="#EA4335"
              d="M12 5.38c1.62 0 3.06.56 4.21 1.65l3.15-3.15C17.45 2.09 14.97 1 12 1A11 11 0 0 0 2.18 7.06l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38z"
            />
          </svg>
          Sign in with Google
        </button>

        <p className="text-xs text-gray-500 mt-6">
          Your email is set from your Google login and cannot be changed.
        </p>
      </div>
    </div>
  );
}