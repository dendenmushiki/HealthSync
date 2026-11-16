import api from '../api/apiClient';

export async function login(username, password) {
  const resp = await api.post('/auth/login', { username, password });
  return resp.data;
}

export async function logout() {
  try {
    if (localStorage.getItem('hs_token')) await api.post('/auth/logout');
  } finally {
    localStorage.removeItem('hs_token');
    localStorage.removeItem('hs_user');
  }
}

export function setAuth(token, user) {
  localStorage.setItem('hs_token', token);
  localStorage.setItem('hs_user', JSON.stringify(user));
}

export function getAuth() {
  const token = localStorage.getItem('hs_token');
  const user = localStorage.getItem('hs_user');
  return { token, user: user ? JSON.parse(user) : null };
}
