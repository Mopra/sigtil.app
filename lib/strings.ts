/**
 * All editor-facing UI text. Danish only for now; keyed so more
 * languages can be added later without touching components.
 */
export const t = {
  appName: 'sigtil',
  tagline: 'Din hjemmeside. Sig til, så ændrer vi den.',

  // Login
  logout: 'Log ud',
  noAccessTitle: 'Ingen adgang endnu',
  noAccessBody: 'Din konto er ikke inviteret til sigtil. Bed den der administrerer siden om at invitere din e-mail.',

  // Site picker
  yourSites: 'Dine hjemmesider',
  openEditor: 'Åbn',

  // Editor
  chatPlaceholder: 'Skriv hvad der skal ændres…',
  chatEmpty: 'Fortæl mig hvad der skal ændres på siden — fx “Skift åbningstiderne til 12–22” eller “Sæt det nye billede ind øverst på forsiden”.',
  thinking: 'Arbejder på det…',
  attach: 'Vedhæft billede eller video',
  uploading: 'Sender fil…',
  uploadFailedImage: 'Billedet kunne ikke sendes. Prøv igen.',
  uploadedMessage: (kind: 'billede' | 'video', ref: string) =>
    `Jeg har uploadet et ${kind} (${ref}). `,

  // Preview
  previewTitle: 'Sådan kommer siden til at se ud',
  previewUpdating: 'Opdaterer visningen…',
  previewOpenNew: 'Åbn i nyt vindue',
  previewNone: 'Lav din første ændring, så dukker den op her.',

  // Publish
  publishButton: 'Udgiv',
  publishAllLive: 'Alt er udgivet',
  publishPending: (n: number) => (n === 1 ? '1 ændring klar til udgivelse' : `${n} ændringer klar til udgivelse`),
  publishWorking: 'Udgiver… det tager et øjeblik',
  publishDone: 'Dine ændringer er nu live ✓',
  publishFailed: 'Udgivelsen mislykkedes. Din side er uændret — prøv igen, eller fortryd ændringerne.',
  undo: 'Fortryd seneste ændring',
  undoAll: 'Fortryd alle ændringer',
  undoDone: 'Ændringen er fortrudt.',
  undoNothing: 'Der er ikke noget at fortryde.',
} as const;
