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
  chatFailed: 'Det lykkedes ikke, og siden er uændret. Prøv igen.',
  conflict:
    'Siden er blevet ændret et andet sted, og det støder sammen med dine ændringer, der ikke er udgivet endnu. Tryk “Fortryd alle ændringer” for at fortsætte fra den nyeste version.',
  attach: 'Vedhæft billede, video eller PDF',
  uploading: 'Sender fil…',
  uploadFailed: 'Filen kunne ikke sendes. Prøv igen.',
  uploadTooLarge: (limitMb: number) => `Filen er for stor. Den må højst fylde ${limitMb} MB.`,
  uploadUnsupported: 'Den filtype kan ikke bruges. Send et billede, en video eller en PDF.',
  // Full noun phrase incl. article — Danish genders differ ("et billede", "en video").
  uploadedLabel: { image: 'et billede', video: 'en video', pdf: 'en PDF' } as Record<string, string>,
  uploadedMessage: (label: string, ref: string) => `Jeg har uploadet ${label} (${ref}). `,
  uploadedWhere: 'Hvor vil du have den ind på siden? Sig til.',

  // Preview
  previewTitle: 'Sådan kommer siden til at se ud',
  previewUpdating: 'Opdaterer visningen…',
  previewOpenNew: 'Åbn i nyt vindue',
  previewNone: 'Lav din første ændring, så dukker den op her.',

  // Pages
  pagePicker: 'Vælg side',
  pageNew: '+ Ny side',
  pageRename: 'Omdøb',
  pageDelete: 'Fjern',
  pageNewPrompt: 'Lav en ny side der hedder ',
  pageRenamePrompt: (label: string) => `Omdøb siden “${label}” til `,
  pageDeletePrompt: (label: string) => `Fjern siden “${label}”.`,

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
