const validatePassword = (password) => {
  const value = typeof password === 'string' ? password : '';
  const requirements = {
    length: Array.from(value).length >= 18,
    uppercase: /[A-Z]/.test(value),
    number: /\d/.test(value),
    symbol: /[^A-Za-z0-9\s]/.test(value),
    bcryptLimit: Buffer.byteLength(value, 'utf8') <= 72,
  };

  return {
    valid: Object.values(requirements).every(Boolean),
    requirements,
    message: 'Password must be at least 18 characters and include an uppercase letter, a number, and a symbol. It must not exceed 72 UTF-8 bytes.',
  };
};

module.exports = { validatePassword };
