/**
 * All editor-facing UI text. Danish only for now; keyed so more
 * languages can be added later without touching components.
 */
export const t = {
  appName: 'sigtil',
  tagline: 'Din hjemmeside. Sig til, så ændrer vi den.',

  // Login
  logout: 'Log ud',
  admin: 'Administration',
  noAccessTitle: 'Ingen adgang endnu',
  noAccessBody: 'Din konto er ikke inviteret til sigtil. Bed den der administrerer siden om at invitere din e-mail.',

  // Site picker
  greeting: (name: string) => `Hej, ${name}`,
  sitesIntro: 'Vælg den hjemmeside du vil arbejde på.',
  noSites: 'Du har ikke adgang til nogen hjemmesider endnu.',
  yourSites: 'Dine hjemmesider',
  openEditor: 'Åbn',

  // Editor
  chatTab: 'Chat',
  previewTab: 'Visning',
  chatPlaceholder: 'Skriv hvad der skal ændres…',
  chatHello: 'Hvad skal vi ændre?',
  chatEmpty: 'Skriv det med dine egne ord. Du ser ændringen til højre, før den bliver udgivet.',
  chatSuggestions: [
    'Skift åbningstiderne til ',
    'Ret teksten øverst på forsiden til ',
    'Sæt et nyt billede ind på forsiden',
    'Lav en ny side der hedder ',
  ],
  thinking: 'Arbejder på det',
  chatFailed: 'Det lykkedes ikke, og siden er uændret. Prøv igen.',
  conflict:
    'Siden er blevet ændret et andet sted, og det støder sammen med dine ændringer, der ikke er udgivet endnu. Fortryd alle ændringer for at fortsætte fra den nyeste version.',
  send: 'Send',
  attach: 'Vedhæft billede, video eller PDF',
  dropHere: 'Slip filen her',
  uploading: 'Sender fil…',
  uploadFailed: 'Filen kunne ikke sendes. Prøv igen.',
  uploadTooLarge: (limitMb: number) => `Filen er for stor. Den må højst fylde ${limitMb} MB.`,
  uploadUnsupported: 'Den filtype kan ikke bruges. Send et billede, en video eller en PDF.',
  // Full noun phrase incl. article, since Danish genders differ ("et billede", "en video").
  uploadedLabel: { image: 'et billede', video: 'en video', pdf: 'en PDF' } as Record<string, string>,
  uploadedMessage: (label: string, ref: string) => `Jeg har uploadet ${label} (${ref}). `,
  uploadedWhere: 'Hvor vil du have den ind på siden? Sig til.',

  // Preview
  previewTitle: 'Sådan kommer siden til at se ud',
  previewUpdating: 'Opdaterer',
  previewOpenNew: 'Åbn i nyt vindue',
  previewNone: 'Lav din første ændring, så dukker siden op her.',
  previewWidth: 'Skærmstørrelse',
  previewWidthMobile: 'Mobil',
  previewWidthTablet: 'Tablet',
  previewWidthFull: 'Fuld bredde',
  previewResize: 'Træk for at ændre bredden. Dobbeltklik for fuld bredde.',

  // Pages
  pagePicker: 'Vælg side',
  pageMore: 'Flere muligheder for siden',
  pageNew: 'Ny side',
  pageRename: 'Omdøb siden',
  pageDelete: 'Fjern siden',
  pageNewPrompt: 'Lav en ny side der hedder ',
  pageRenamePrompt: (label: string) => `Omdøb siden “${label}” til `,
  pageDeletePrompt: (label: string) => `Fjern siden “${label}”.`,

  // Publish
  publishButton: 'Udgiv',
  publishAllLive: 'Alt er udgivet',
  publishPending: (n: number) => (n === 1 ? '1 ændring' : `${n} ændringer`),
  publishPendingHint: 'klar til udgivelse',
  publishWorking: 'Udgiver…',
  publishDone: 'Dine ændringer er nu live',
  publishFailed: 'Udgivelsen mislykkedes. Din side er uændret. Prøv igen, eller fortryd ændringerne.',
  undoMenu: 'Fortryd',
  undo: 'Fortryd seneste ændring',
  undoAll: 'Fortryd alle ændringer',
  undoAllConfirm: 'Tryk igen for at fortryde alt',
  undoDone: 'Ændringen er fortrudt.',
  undoNothing: 'Der er ikke noget at fortryde.',
} as const;
