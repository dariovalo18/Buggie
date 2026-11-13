// Français: text of the main process. Keys as in en.cjs; a key left out reads en.cjs.
module.exports = {
  starting: 'Démarrage…',

  trayOpenSettings: 'Ouvrir les paramètres',
  trayShowPet: "Afficher le compagnon",
  trayHidePet: "Masquer le compagnon",
  trayClickThroughOn: "Laisser passer les clics à travers Buggie",
  trayClickThroughOff: "Ne plus laisser passer les clics à travers Buggie",
  trayClickThroughTip: 'Buggie (les clics traversent Buggie)',
  trayRestart: 'Redémarrer',
  trayQuit: 'Quitter',

  coreFailed: (times, code, logFile) => `Le Core s'est arrêté ${times} fois en 5 minutes (code de sortie ${code}) et n'est plus redémarré. Si l'application vient d'être mise à jour, choisissez « Quitter » dans le menu de la barre d'état, puis rouvrez Buggie. Journal : ${logFile}`,
  coreIncomplete: (url, logFile) => `Des fichiers de Buggie manquent : le Core ne peut pas démarrer. Téléchargez le programme d'installation complet depuis ${url} et installez-le dans le même dossier ; les paramètres, API Keys, prompts et la mémoire sont conservés. Journal : ${logFile}`,
  coreRestarting: (code) => `Le Core s'est arrêté de façon inattendue (code de sortie ${code}) ; redémarrage dans 3 secondes`,
  coreLocked: (pid, file) => `Un autre processus${pid ? ` (PID ${pid})` : ''} utilise les données de Buggie, le Core n'a donc pas démarré. Attendez qu'il se termine ou arrêtez-le, puis choisissez « Redémarrer » dans le menu de la barre d'état. Fichier de verrou : ${file}`,
  corePortsBusy: (from, to) => `Les ports de la console ${from}–${to} sont tous pris, le Core n'a donc pas démarré. ${to - from + 1} copies de Buggie tournent peut-être déjà, ou d'autres programmes utilisent ces ports. Fermez-en un, puis choisissez « Redémarrer » dans le menu de la barre d'état.`,

  strandedMessage: "Des paramètres d'avant la mise à jour ont été trouvés",
  strandedDetail: (stranded, parent) => `Une mise à jour automatique précédente a installé Buggie à son emplacement actuel. Les paramètres, API Keys, prompts et la mémoire d'avant cette mise à jour se trouvent toujours dans :\n${stranded}\n\n`
    + `Revenir en arrière renomme les données actuelles en data-replaced-<heure> et les conserve dans ${parent} ; rien n'est supprimé. Après « Garder les actuels », la question ne sera plus posée.`,
  strandedRestore: "Reprendre les paramètres d'avant",
  strandedKeep: 'Garder les actuels',

  dataNotWritable: (dir, suggested) => `Buggie ne peut pas écrire dans son dossier de données et n'a pas démarré :\n${dir}\n\nRelancez le programme d'installation et installez Buggie dans un dossier où votre compte peut écrire, par exemple :\n${suggested}`,

  dataFoundMessage: 'Des données Buggie antérieures ont été trouvées',
  dataFoundDetail: (data, when, program) => `Buggie est maintenant installé dans ${program}, qui n'a pas encore de données. Les données utilisées jusqu'ici se trouvent dans :\n${data}\nDernier démarrage : ${when}\n\n`
    + 'En les reprenant, vous gardez les paramètres, API Keys, prompts et la mémoire. En repartant de zéro, Buggie recommence ici ; les anciennes données restent à leur place et ne sont pas supprimées.',
  dataInherit: 'Reprendre ces données',
  dataNew: 'Repartir de zéro',
  dataMissingMessage: "Les données utilisées jusqu'ici sont introuvables",
  dataMissingDetail: (data, when, beside) => `Les données utilisées jusqu'ici étaient dans :\n${data}\nDernier démarrage : ${when}\nIl n'y a plus de données Buggie à cet endroit.\n\n`
    + `Si elles sont sur un disque amovible ou un emplacement réseau, connectez-le puis cliquez sur Réessayer. Si elles ont été déplacées, cliquez sur Choisir un dossier pour les retrouver. Repartir de zéro recommence ici :\n${beside}`,
  dataRetry: 'Réessayer',
  dataChoose: 'Choisir un dossier',
  dataQuit: 'Quitter',
  dataChooseTitle: 'Choisir le dossier de données de Buggie',
  dataChooseInvalid: (dir) => `Ce dossier ne contient pas de données Buggie :\n${dir}\n\nChoisissez le dossier d'installation, ou le dossier data qu'il contient.`,
};
