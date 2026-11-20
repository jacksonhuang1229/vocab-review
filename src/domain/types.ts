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
};
