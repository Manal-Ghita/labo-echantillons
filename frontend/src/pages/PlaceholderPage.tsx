export function PlaceholderPage({ kind }: { kind: 'samples' | 'catalog' }) {
  const samples = kind === 'samples'
  return (
    <section className="page">
      <p className="eyebrow">ESPACE DU LABORATOIRE</p>
      <div className="page-heading">
        <div>
          <h1>{samples ? 'Échantillons' : 'Catalogue des opérations'}</h1>
          <p className="muted">
            {samples
              ? 'Retrouver chaque échantillon, suivre son parcours.'
              : 'Des définitions communes pour documenter les fabrications.'}
          </p>
        </div>
        <span className="status-tag">Espace en préparation</span>
      </div>
      <div className="placeholder-card">
        <div className="placeholder-symbol" aria-hidden="true">
          {samples ? '◇' : '≡'}
        </div>
        <h2>
          {samples
            ? 'Vos échantillons, bientôt ici'
            : 'Les types d’étapes, bientôt ici'}
        </h2>
        <p>
          {samples
            ? 'Cet espace accueillera la liste des échantillons et leur historique de fabrication.'
            : 'Cet espace présentera les opérations du laboratoire et leurs paramètres de fabrication.'}
        </p>
        <p className="muted">
          Votre session est ouverte. La consultation détaillée sera disponible
          prochainement.
        </p>
      </div>
    </section>
  )
}
