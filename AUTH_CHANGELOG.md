# Authentication Improvements

What I changed:

- Added `AuthContext` at `src/context/AuthContext.tsx` to centralize authentication state (user, token) and provide login/signup/logout/refresh functions.
- Updated `authService` to automatically set tokens on successful login/signup.
- Improved `apiClient` error handling to clear token on 401 but not force a redirect; JSON error messages are parsed and thrown.
- Wrapped `App` with `AuthProvider` in `src/main.tsx`.
- Updated `Header` to use `AuthContext` to show the user's initial, name/email, role, and a logout button.
- Updated `AuthModal` to use `AuthContext` for login/signup calls and simplified the flow.
- Added placeholder handlers for Google/Phone sign-in in `AuthModal`.

How to test locally (manual steps):

1. Start the backend server (from `backend/`):

```powershell
cd backend
npm install
npm run dev
```

2. Start the frontend (from project root):

```powershell
npm install
npm run dev
```

3. Open the app (default is `http://localhost:3000/`), click "Log In" or "Sign Up" from the header.

4. Try to sign up a new user (email, name, password) and select a role. The modal will close and the app will navigate to the correct dashboard (client/provider) based on the role.

5. Test login with an existing user; the header should display the user and a logout button. Clicking logout should clear the user and redirect to the landing view.

Notes and follow-ups:
- Social sign-in (Google) and phone OTP flows are placeholders and need OAuth server integration or a phone provider to implement.
- The one-line change to the `backend/src/middleware/auth.ts` ensures JWT verification is done using `jsonwebtoken`.
- There is currently no `/auth/logout` backend endpoint; `authService.logout` attempts to POST to it and ignores errors.

Potential improvements:
- Add refresh tokens (with httpOnly cookies) for better security.
- Add a small unit test for `AuthContext` flows and `authService`.
- Add integration tests for backend auth routes.
