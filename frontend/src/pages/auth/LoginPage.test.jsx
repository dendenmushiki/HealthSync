import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AuthContext } from '../../context/AuthContext';
import LoginPage from './LoginPage';

const renderLoginPage = (login) => render(
  <AuthContext.Provider value={{ login }}>
    <MemoryRouter>
      <LoginPage />
    </MemoryRouter>
  </AuthContext.Provider>
);

test('exposes accessible credential fields and password visibility control', () => {
  renderLoginPage(jest.fn());

  const username = screen.getByLabelText('Username');
  const password = screen.getByLabelText('Password');

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
  let finishLogin;
  const login = jest.fn(() => new Promise((resolve) => {
    finishLogin = resolve;
  }));
  renderLoginPage(login);

  fireEvent.change(screen.getByLabelText('Username'), { target: { value: '  bhw-user  ' } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'incorrect' } });
  fireEvent.submit(screen.getByRole('form', { name: 'HEALTHSYNC PORTAL' }));

  const submitButton = screen.getByRole('button', { name: 'Signing in…' });
  expect(submitButton).toBeDisabled();
  expect(login).toHaveBeenCalledWith('bhw-user', 'incorrect');

  finishLogin({ success: false, message: 'Invalid credentials' });

  const errorMessage = await screen.findByText('Please check your username and password.');
  expect(errorMessage.closest('.hs-status-banner')).toBeInTheDocument();
  expect(screen.getByLabelText('Username')).toHaveAttribute('aria-invalid', 'true');
  expect(screen.getByLabelText('Password')).toHaveAttribute('aria-describedby', 'login-error');
  expect(screen.getByRole('button', { name: /login/i })).toBeEnabled();
});

test('shows the credential message when invalid credentials reject with HTTP 401', async () => {
  const logError = jest.spyOn(console, 'error').mockImplementation(() => {});
  const login = jest.fn().mockRejectedValue({
    response: { status: 401, data: { message: 'Invalid credentials' } },
  });
  renderLoginPage(login);

  fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'bhw-user' } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'incorrect' } });
  fireEvent.submit(screen.getByRole('form', { name: 'HEALTHSYNC PORTAL' }));

  expect(await screen.findByText('Please check your username and password.')).toBeInTheDocument();
  logError.mockRestore();
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
