import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AuthContext } from '../../context/AuthContext';
import { ThemeProvider } from '../../context/ThemeContext';
import { LoginTransitionContext } from '../../components/auth/LoginTransitionContext';
import LoginPage from './LoginPage';

const beginLoginTransition = jest.fn();

const renderLoginPage = (login) => render(
  <ThemeProvider>
    <MemoryRouter>
      <LoginTransitionContext.Provider value={{ beginLoginTransition }}>
        <AuthContext.Provider value={{ login }}>
          <LoginPage />
        </AuthContext.Provider>
      </LoginTransitionContext.Provider>
    </MemoryRouter>
  </ThemeProvider>
);

test('exposes accessible credential fields and password visibility control', () => {
  renderLoginPage(jest.fn());

  const username = screen.getByLabelText('Username or email address');
  const password = screen.getByLabelText('Password');

  expect(username).toHaveAttribute('placeholder', 'Enter username or email');
  expect(username).toHaveAttribute('autocomplete', 'username');
  expect(username).toHaveAttribute('autocapitalize', 'none');
  expect(username).toHaveAttribute('enterkeyhint', 'next');
  expect(password).toHaveAttribute('autocomplete', 'current-password');
  expect(password).toHaveAttribute('enterkeyhint', 'go');
  expect(screen.getByRole('form', { name: 'HEALTHSYNC PORTAL' })).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Show password' }));
  expect(password).toHaveAttribute('type', 'text');
  expect(screen.getByRole('button', { name: 'Hide password' })).toHaveAttribute('aria-pressed', 'true');
});

test('disables repeated submissions and announces authentication errors', async () => {
  beginLoginTransition.mockClear();
  let finishLogin;
  const login = jest.fn(() => new Promise((resolve) => {
    finishLogin = resolve;
  }));
  renderLoginPage(login);

  fireEvent.change(screen.getByLabelText('Username or email address'), { target: { value: '  bhw-user  ' } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'incorrect' } });
  fireEvent.submit(screen.getByRole('form', { name: 'HEALTHSYNC PORTAL' }));

  const submitButton = screen.getByRole('button', { name: 'Signing in…' });
  expect(submitButton).toBeDisabled();
  expect(login).toHaveBeenCalledWith('bhw-user', 'incorrect');

  finishLogin({ success: false, message: 'Invalid credentials' });

  const errorMessage = await screen.findByText('Please check your username or email and password.');
  expect(errorMessage.closest('.hs-status-banner')).toBeInTheDocument();
  expect(beginLoginTransition).not.toHaveBeenCalled();
  expect(screen.getByLabelText('Username or email address')).toHaveAttribute('aria-invalid', 'true');
  expect(screen.getByLabelText('Password')).toHaveAttribute('aria-describedby', 'login-error');
  expect(screen.getByRole('button', { name: /login/i })).toBeEnabled();
});

test('starts the intro after success and keeps the admin dashboard redirect', async () => {
  beginLoginTransition.mockClear();
  const login = jest.fn().mockResolvedValue({
    success: true,
    user: { role: 'admin' },
    mustChangePassword: false,
  });
  renderLoginPage(login);

  fireEvent.change(screen.getByLabelText('Username or email address'), { target: { value: 'admin' } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'correct-password' } });
  fireEvent.submit(screen.getByRole('form', { name: 'HEALTHSYNC PORTAL' }));

  await waitFor(() => expect(beginLoginTransition).toHaveBeenCalledTimes(1));
});

test('shows the credential message when invalid credentials reject with HTTP 401', async () => {
  const logError = jest.spyOn(console, 'error').mockImplementation(() => {});
  const login = jest.fn().mockRejectedValue({
    response: { status: 401, data: { message: 'Invalid credentials' } },
  });
  renderLoginPage(login);

  fireEvent.change(screen.getByLabelText('Username or email address'), { target: { value: 'bhw-user' } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'incorrect' } });
  fireEvent.submit(screen.getByRole('form', { name: 'HEALTHSYNC PORTAL' }));

  expect(await screen.findByText('Please check your username or email and password.')).toBeInTheDocument();
  logError.mockRestore();
});

test('submits email addresses through the existing login identifier', async () => {
  const login = jest.fn().mockResolvedValue({ success: false, message: 'Invalid credentials' });
  renderLoginPage(login);

  fireEvent.change(screen.getByLabelText('Username or email address'), { target: { value: '  bhw@example.org  ' } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'correct-password' } });
  fireEvent.submit(screen.getByRole('form', { name: 'HEALTHSYNC PORTAL' }));

  expect(login).toHaveBeenCalledWith('bhw@example.org', 'correct-password');
  expect(await screen.findByText('Please check your username or email and password.')).toBeInTheDocument();
});

test('opens the terms and privacy policy modal from the login agreement and closes with Escape', () => {
  renderLoginPage(jest.fn());

  const termsLink = screen.getByRole('button', { name: 'Terms of Use' });
  fireEvent.click(termsLink);

  const dialog = screen.getByRole('dialog', { name: 'Terms of Use and Privacy Policy for HealthSync' });
  expect(dialog).toHaveTextContent('PART I: TERMS OF USE');
  expect(dialog).toHaveTextContent('PART II: PRIVACY POLICY (RA 10173 COMPLIANCE)');
  expect(dialog).toHaveTextContent('densane07@gmail.com');

  fireEvent.keyDown(document, { key: 'Escape' });
  expect(screen.queryByRole('dialog', { name: 'Terms of Use and Privacy Policy for HealthSync' })).not.toBeInTheDocument();
  expect(termsLink).toHaveFocus();

  fireEvent.click(screen.getByRole('button', { name: 'Privacy Policy' }));
  expect(screen.getByRole('dialog', { name: 'Terms of Use and Privacy Policy for HealthSync' })).toBeInTheDocument();
});
