import type { ImageAsset } from '../domain/types';
import { IMAGE_STORE, runStore } from './wordSetStore';

export async function listImages(): Promise<ImageAsset[]> {
  return runStore(IMAGE_STORE, 'readonly', (store) => store.getAll() as IDBRequest<ImageAsset[]>);
}

export async function getImage(id: string): Promise<ImageAsset | undefined> {
  return runStore(IMAGE_STORE, 'readonly', (store) => store.get(id) as IDBRequest<ImageAsset | undefined>);
}

export async function saveImage(asset: ImageAsset): Promise<void> {
  await runStore(IMAGE_STORE, 'readwrite', (store) => store.put(asset));
}

export async function deleteImage(id: string): Promise<void> {
  await runStore(IMAGE_STORE, 'readwrite', (store) => store.delete(id));
}
