function verifiedIdentity(result, staffOnly = false) {
  const user = result?.users?.[0];
  if (!user?.localId || user.disabled) throw new Error('Log opnieuw in.');
  let claims = {};
  try {
    claims = JSON.parse(user.customAttributes || '{}');
  } catch {
    throw new Error('Ongeldige accountrol.');
  }
  if (staffOnly && claims.staff !== true) throw new Error('Geen medewerkerstoegang.');
  return { uid: user.localId, email: user.email || '', staff: claims.staff === true };
}
if (typeof module !== 'undefined') module.exports = { verifiedIdentity };
