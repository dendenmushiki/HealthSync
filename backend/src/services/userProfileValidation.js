const validateUserContactInfo = ({ contact_number, email } = {}, { required = false } = {}) => {
  const fieldErrors = {};
  const normalized = { contact_number: null, email: null };
  const phone = typeof contact_number === 'string' ? contact_number.trim() : '';
  const address = typeof email === 'string' ? email.trim().toLowerCase() : '';

  if ((contact_number !== undefined && typeof contact_number !== 'string') || (required && !phone)) {
    fieldErrors.contact_number = 'Enter a contact number.';
  } else if (phone) {
    const digits = phone.replace(/\D/g, '');
    if (phone.length > 32 || !/^\+?[0-9][0-9\s().-]*$/.test(phone) || digits.length < 7 || digits.length > 15) {
      fieldErrors.contact_number = 'Enter a valid contact number.';
    } else {
      normalized.contact_number = phone;
    }
  }

  if ((email !== undefined && typeof email !== 'string') || (required && !address)) {
    fieldErrors.email = 'Enter an email address.';
  } else if (address) {
    if (address.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
      fieldErrors.email = 'Enter a valid email address.';
    } else {
      normalized.email = address;
    }
  }

  return { ...normalized, fieldErrors };
};

module.exports = { validateUserContactInfo };
