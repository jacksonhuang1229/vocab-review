/** A saved lesson. `entries` is the display order. */
export type WordSet = {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  entries: WordEntry[];
};

/** One English word or phrase. Meaning hint and image id are optional. */
export type WordEntry = {
  id: string;
  spelling: string;
  meaningHint?: string;
  imageId?: string;
  /** Parent marked this as an abstract word that needs a scene picture. */
  abstract?: boolean;
  /** Spelling the parent reconfirmed for the linked picture after an edit. */
  imageAcceptedSpelling?: string;
  /** Meaning the parent reconfirmed for the linked picture after an edit. */
  imageAcceptedMeaning?: string;
};

/** One shared picture. Several lessons can point at the same id. */
export type ImageAsset = {
  id: string;
  word: string;
  meaning: string;
  blob: Blob;
  source: 'upload';
  sceneConfirmed: boolean;
  createdAt: number;
};
