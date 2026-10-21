export default function CatalogAccess({ loading, error, needsPassword, onUnlock }) {
  if (loading) return <p>Loading prices...</p>;
  if (!error && !needsPassword) return null;

  return (
    <form
      className="settings-card"
      onSubmit={(event) => {
        event.preventDefault();
        const password = String(new FormData(event.currentTarget).get("password") || "");
        onUnlock(password);
      }}
    >
      <p>{error || "Enter the access password to load prices."}</p>
      {needsPassword && (
        <>
          <label htmlFor="catalog-password">Access password</label>
          <input id="catalog-password" name="password" type="password" autoComplete="current-password" />
          <button className="btn-primary" type="submit">
            Unlock prices
          </button>
        </>
      )}
    </form>
  );
}
