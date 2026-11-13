import type { en } from './strings.ts';

export const S: Partial<typeof en> = {
  // advanced/features/prompts/index.ts
  button: "Effacer la conversation et recommencer",
  title: "Effacer la conversation actuelle et recommencer ?",
  body: "Enregistre les modifications de cette page, puis efface le contexte de la conversation actuelle de Buggie et recommence avec le prompt système actualisé. L’effacement est irréversible. Memory et la persona sont conservés.",
  clearing: "Démarrage de la conversation…",
  cleared: "Nouvelle conversation démarrée",
  // release.ts
  updateShort: (version: string) => `v${version} disponible`,
  updateDownloadingShort: (version: string) => `Téléchargement de v${version}`,
  updateReadyShort: (version: string) => `v${version} prêt`,
  updateFailedShort: (version: string) => `Télécharger v${version}`,
  repoHint: 'Ouvrir le projet Buggie sur GitHub',
  update: (latest: string) => `Buggie ${latest} est disponible : téléchargez la mise à jour`,
  updateDownloading: (version: string) => `Buggie ${version} se télécharge en arrière-plan`,
  updateReady: (version: string) => `Buggie ${version} est téléchargé et s'installe à la fermeture`,
  updateFailed: (version: string) => `Buggie ${version} n'a pas pu être téléchargé : le télécharger manuellement`,
};
