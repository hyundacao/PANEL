export const DEFAULT_RESET_PASSWORD = 'MAX123';

export const getPasswordValidationError = (password: string) => {
  if (password.length < 12 || new TextEncoder().encode(password).length > 72) return 'PASSWORD_POLICY';
  return null;
};
