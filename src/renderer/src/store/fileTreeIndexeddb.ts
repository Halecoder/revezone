import { openDB, DBSchema, IDBPDatabase } from 'idb';
import { v4 as uuidv4 } from 'uuid';
import moment from 'moment-timezone';
import { RevezoneFile, RevezoneFolder, RevezoneFileType, RevezoneFileTree } from '../types/file';
import { submitUserEvent } from '../utils/statistics';
import { menuIndexeddbStorage } from './_menuIndexeddb';
import { blocksuiteStorage } from './blocksuite';
import { boardIndexeddbStorage } from './boardIndexeddb';

moment.tz.setDefault('Asia/Shanghai');

export interface RevezoneDBSchema extends DBSchema {
  // file: {
  //   key: string;
  //   value: RevezoneFile;
  // };
  file_tree: {
    key: string;
    value: RevezoneFileTree;
  };
}

export const INDEXEDDB_REVEZONE_FILE_TREE_STORAGE = 'revezone_file_tree';
// export const INDEXEDDB_FILE = 'file';
export const INDEXEDDB_FILE_TREE = 'file_tree';

class FileTreeIndexeddbStorage {
  constructor() {
    if (FileTreeIndexeddbStorage.instance) {
      return FileTreeIndexeddbStorage.instance;
    }

    FileTreeIndexeddbStorage.instance = this;

    (async () => {
      this.db = await this.initDB();
    })();
  }

  static instance: FileTreeIndexeddbStorage;
  static oldDBSynced = false;

  db: IDBPDatabase<RevezoneDBSchema> | undefined;

  async initDB(): Promise<IDBPDatabase<RevezoneDBSchema>> {
    if (this.db) {
      return this.db;
    }

    const db = await openDB<RevezoneDBSchema>(INDEXEDDB_REVEZONE_FILE_TREE_STORAGE, 1, {
      upgrade: async (db) => {
        // await this.initFileStore(db);
        await this.initFileTreeStore(db);
      }
    });

    this.db = db;

    return db;
  }

  // async initFileStore(db): Promise<IDBObjectStore> {
  //   const fileStore: IDBObjectStore = await db.createObjectStore(INDEXEDDB_FILE, {
  //     autoIncrement: true
  //   });

  //   await fileStore.createIndex('type', 'type', { unique: false });

  //   return fileStore;
  // }

  async initFileTreeStore(db): Promise<IDBObjectStore> {
    const fileTreeStore: IDBObjectStore = await db.createObjectStore(INDEXEDDB_FILE_TREE, {
      autoIncrement: true
    });

    return fileTreeStore;
  }

  async addFolder(name?: string, parentId?: string) {
    const id = `folder_${uuidv4()}`;

    console.log('--- addFolder ---', name, parentId);

    const folderInfo = {
      id,
      name: name || 'New Folder',
      gmtCreate: moment().toLocaleString(),
      gmtModified: moment().toLocaleString()
    };

    await this.addFileTreeItem(folderInfo, true, parentId);

    submitUserEvent('create_folder', folderInfo);

    return folderInfo;
  }

  async addFileTreeItem(info: RevezoneFile | RevezoneFolder, isFolder: boolean, parentId?: string) {
    await this.initDB();

    const fileTree = (await this.getFileTree()) || {};

    fileTree[info.id] = { index: info.id, isFolder, data: info };

    if (parentId) {
      const children = fileTree[parentId].children || [];
      fileTree[parentId].children = [info.id, ...children];
    } else {
      const children = fileTree.root.children || [];
      fileTree.root.children = [info.id, ...children];
    }

    await this.updateFileTree(fileTree);

    return info;
  }

  async addFile(
    name?: string,
    type: RevezoneFileType = 'note',
    parentId?: string
  ): Promise<RevezoneFile> {
    const fileId = `file_${uuidv4()}`;

    if (type === 'note') {
      await blocksuiteStorage.addPage(fileId);
    } else if (type === 'board') {
      await boardIndexeddbStorage.addBoard(fileId, '{}');
    }

    const fileInfo = {
      id: fileId,
      name: name || '',
      type,
      gmtCreate: moment().toLocaleString(),
      gmtModified: moment().toLocaleString()
    };

    await this.addFileTreeItem(fileInfo, false, parentId);

    submitUserEvent(`create_${type}`, fileInfo);

    return fileInfo;
  }

  async updateFileTree(fileTree: RevezoneFileTree) {
    await this.db?.put(INDEXEDDB_FILE_TREE, fileTree, INDEXEDDB_FILE_TREE);

    return fileTree;
  }

  // // TODO: NOT FINISHED, DO NOT USE
  // async _copyFile(copyFileId: string, folderId: string) {
  //   await this.initDB();

  //   if (!(copyFileId && folderId)) return;

  //   const copyFile = await this.db?.get(INDEXEDDB_FILE, copyFileId);

  //   await this.addFile(folderId, copyFile?.type);

  //   // await blocksuiteStorage.copyPage();
  // }

  async getFile(fileId: string): Promise<RevezoneFile | undefined> {
    await this.initDB();
    const fileTree = (await this.db?.get(INDEXEDDB_FILE_TREE, INDEXEDDB_FILE_TREE)) as
      | RevezoneFile
      | undefined;
    return fileTree?.[fileId].data;
  }

  async deleteFile(fileId: string) {
    await this.initDB();

    const fileTree = await this.deleteItemFromFileTree(fileId);

    const file = fileTree[fileId].data as RevezoneFile;

    // const file = await this.getFile(fileId);

    // if (!file) return;

    // file && (await this.db?.delete(INDEXEDDB_FILE, fileId));

    submitUserEvent(`delete_${file.type}`, file);
  }

  async deleteItemFromFileTree(id: string): Promise<RevezoneFileTree> {
    const newTree = {};

    const tree: RevezoneFileTree | undefined = await this.getFileTree();

    tree &&
      Object.entries(tree).forEach(([key, item]) => {
        if (key !== id) {
          item.children = item.children?.filter((_key) => _key !== id);
          newTree[key] = item;
        }
      });

    this.updateFileTree(newTree);

    return newTree;
  }

  // async getFiles(): Promise<RevezoneFile[]> {
  //   await this.initDB();
  //   const files = await this.db?.getAll(INDEXEDDB_FILE);
  //   const sortFn = (a: RevezoneFile, b: RevezoneFile) =>
  //     new Date(a.gmtCreate).getTime() < new Date(b.gmtCreate).getTime() ? 1 : -1;
  //   return files?.sort(sortFn) || [];
  // }

  async transferDataFromMenuIndexedDB(oldFileTree) {
    if (FileTreeIndexeddbStorage.oldDBSynced) return;

    FileTreeIndexeddbStorage.oldDBSynced = true;

    this.updateFileTree(oldFileTree);

    // const oldFiles = await menuIndexeddbStorage.getFiles();

    // oldFiles.forEach((oldFile) => {
    //   this.db?.add(INDEXEDDB_FILE, oldFile, oldFile.id);
    // });
  }

  async getFileTree(): Promise<RevezoneFileTree | undefined> {
    await this.initDB();
    const fileTree = await this.db?.get(INDEXEDDB_FILE_TREE, INDEXEDDB_FILE_TREE);

    // DEBUG
    // @ts-ignore
    window.fileTree = fileTree;

    let oldFileTree;

    if (!fileTree) {
      oldFileTree = await menuIndexeddbStorage.getFileTreeFromOlderData();

      this.transferDataFromMenuIndexedDB(oldFileTree);
    }

    return fileTree || oldFileTree;
  }

  async updateFileName(file: RevezoneFile, name: string) {
    await this.initDB();

    if (name === file?.name) return;

    const fileTree = await this.getFileTree();

    if (!fileTree) return;

    fileTree[file.id].data.name = name;

    await this.updateFileTree(fileTree);

    // file &&
    //   (await this.db?.put(
    //     INDEXEDDB_FILE,
    //     { ...file, name, gmtModified: moment().toLocaleString() },
    //     file.id
    //   ));
  }

  async updateFileGmtModified(file: RevezoneFile) {
    await this.initDB();

    const fileTree = await this.getFileTree();

    if (!fileTree) return;

    fileTree[file.id].data.gmtModified = moment().toLocaleString();

    await this.updateFileTree(fileTree);

    // file &&
    //   (await this.db?.put(
    //     INDEXEDDB_FILE,
    //     { ...file, gmtModified: moment().toLocaleString() },
    //     file.id
    //   ));
  }

  async updateFolderName(folder: RevezoneFolder, name: string) {
    await this.initDB();

    if (name === folder?.name) return;

    const fileTree = await this.getFileTree();

    if (!fileTree) return;

    fileTree[folder.id].data.name = name;

    await this.updateFileTree(fileTree);
  }

  async deleteFolder(folderId: string) {
    if (!folderId) return;

    await this.initDB();

    const fileTree = await this.getFileTree();

    if (!fileTree) return;

    const filesInFolder = fileTree?.[folderId]?.children as string[];

    delete fileTree[folderId];

    filesInFolder?.forEach((fileId) => {
      delete fileTree[fileId];
    });

    await this.updateFileTree(fileTree);

    // const deleteFilesPromise = filesInFolder?.map(async (fileId) =>
    //   this.db?.delete(INDEXEDDB_FILE, fileId)
    // );

    // deleteFilesPromise && (await Promise.all(deleteFilesPromise));

    submitUserEvent('delete_folder', { id: folderId });
  }
}

export const fileTreeIndexeddbStorage = new FileTreeIndexeddbStorage();
