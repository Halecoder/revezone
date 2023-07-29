import { useCallback, useEffect, useState, useRef } from 'react';
import { Menu, Dropdown } from 'antd';
import { menuIndexeddbStorage } from '@renderer/store/menuIndexeddb';
import type { RevenoteFile, RevenoteFolder, OnFolderOrFileAddProps } from '@renderer/types/file';
import {
  getOpenKeysFromLocal,
  // getSelectedKeysFromLocal,
  setCurrentFileIdToLocal,
  setOpenKeysToLocal
  // setSelectedKeysToLocal
} from '@renderer/store/localstorage';
import { useAtom } from 'jotai';
import { currentFileAtom, fileTreeAtom, currentFolderIdAtom } from '@renderer/store/jotai';
import EditableText from '../EditableText';
import { blocksuiteStorage } from '@renderer/store/blocksuite';
import useBlocksuitePageTitle from '@renderer/hooks/useBlocksuitePageTitle';
import { useDebounceEffect } from 'ahooks';
import OperationBar from '../OperationBar';
import moment from 'moment';
import RevenoteLogo from '../RevenoteLogo';

import './index.css';
import { getFileById, getFolderIdByFileId } from '@renderer/utils/file';
import { Folder } from 'lucide-react';
import useAddFile from '@renderer/hooks/useAddFile';
import useFileContextMenu from '@renderer/hooks/useFileContextMenu';
import useFolderContextMenu from '@renderer/hooks/useFolderContextMenu';
import { getCurrentFileIdFromLocal } from '@renderer/store/localstorage';

interface Props {
  collapsed: boolean;
}

export default function CustomMenu({ collapsed }: Props) {
  const [openKeys, setOpenKeys] = useState<string[]>(getOpenKeysFromLocal());
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [currentFile, setCurrentFile] = useAtom(currentFileAtom);
  const [pageTitle] = useBlocksuitePageTitle();
  const [fileTree, setFileTree] = useAtom(fileTreeAtom);
  const [currentFolderId, setCurrentFolderId] = useAtom(currentFolderIdAtom);
  const [editableTextState, setEditableTextState] = useState<{ [key: string]: boolean }>({});
  const firstRenderRef = useRef(false);

  const onFolderOrFileAdd = useCallback(
    ({ fileId, folderId, type }: OnFolderOrFileAddProps) => {
      setOpenKeys([...openKeys, folderId]);
      updateEditableTextState(fileId || folderId, false, editableTextState);
      if (type === 'file') {
        addSelectedKeys(fileId ? [fileId] : []);
      } else if (type === 'folder') {
        resetMenu();
        setCurrentFile(undefined);
        setSelectedKeys([folderId]);
      }
    },
    [openKeys, editableTextState]
  );

  const [addFile] = useAddFile({ onAdd: onFolderOrFileAdd });

  const getFileTree = useCallback(async () => {
    const tree = await menuIndexeddbStorage.getFileTree();
    setFileTree(tree);
    return tree;
  }, []);

  useEffect(() => {
    !collapsed && getFileTree();
  }, [menuIndexeddbStorage, collapsed]);

  useEffect(() => {
    if (firstRenderRef.current === true || !fileTree?.length) return;
    firstRenderRef.current = true;

    const currentFileIdFromLocal = getCurrentFileIdFromLocal();
    const file = currentFileIdFromLocal ? getFileById(currentFileIdFromLocal, fileTree) : undefined;

    setCurrentFile(file);
  }, [fileTree]);

  useEffect(() => {
    if (firstRenderRef.current === false) return;
    setCurrentFileIdToLocal(currentFile?.id);
    setSelectedKeys(currentFile?.id ? [currentFile.id] : []);
  }, [currentFile?.id]);

  useEffect(() => {
    if (!currentFile) {
      return;
    }
    const folderId = getFolderIdByFileId(currentFile.id, fileTree);
    setCurrentFolderId(folderId);
  }, [currentFile, fileTree]);

  const refreshMenu = useCallback(async () => {
    await getFileTree();
  }, [pageTitle]);

  useDebounceEffect(
    () => {
      refreshMenu();
    },
    [pageTitle],
    {
      wait: 200
    }
  );

  const addSelectedKeys = useCallback(
    (keys: string[] | undefined) => {
      if (!keys) return;

      let newKeys = selectedKeys;

      keys.forEach((key: string) => {
        const type = key?.startsWith('folder_') ? 'folder' : 'file';

        newKeys = type ? newKeys.filter((_key) => !_key?.startsWith(type)) : newKeys;
      });

      newKeys = Array.from(new Set([...newKeys, ...keys])).filter((_key) => !!_key);

      setSelectedKeys(newKeys);
    },
    [selectedKeys]
  );

  const deleteFile = useCallback(
    async (fileId: string, folderId: string) => {
      await menuIndexeddbStorage.deleteFile(fileId);
      await blocksuiteStorage.deletePage(fileId);

      const tree = await getFileTree();

      // reset current file when current file is removed
      if (currentFile?.id === fileId) {
        const filesInFolder = tree.find((folder) => folder.id === folderId)?.children;

        setCurrentFile(filesInFolder?.[0]);
      }
    },
    [menuIndexeddbStorage, currentFile]
  );

  const updateEditableTextState = useCallback((id: string, value: boolean, editableTextState) => {
    const newEditableTextState = { ...editableTextState };
    newEditableTextState[id] = value;
    setEditableTextState(newEditableTextState);
  }, []);

  const deleteFolder = useCallback(
    async (folderId: string) => {
      await menuIndexeddbStorage.deleteFolder(folderId);
      await getFileTree();
    },
    [menuIndexeddbStorage]
  );

  const [getFileContextMenu] = useFileContextMenu({
    editableTextState,
    deleteFile,
    updateEditableTextState
  });

  const [getFolderContextMenu] = useFolderContextMenu({
    fileTree,
    editableTextState,
    updateEditableTextState,
    addFile,
    deleteFolder
  });

  const resetMenu = useCallback(() => {
    setCurrentFile(undefined);
    setCurrentFolderId(undefined);
    setSelectedKeys([]);
  }, []);

  const onOpenChange = useCallback(
    (keys) => {
      const folderKeys = keys.filter((key) => key.startsWith('folder_'));
      const openFolderKeys = openKeys.filter((key) => key.startsWith('folder_'));

      const diffNum = folderKeys?.length - openFolderKeys.length;

      let changeType;

      switch (true) {
        case diffNum === 0:
          changeType = 'unchanged';
          break;
        case diffNum > 0:
          changeType = 'increase';
          break;
        default:
          changeType = 'decrease';
          break;
      }

      console.log('onOpenChange', changeType, folderKeys, openFolderKeys);

      setOpenKeys(keys);
      setOpenKeysToLocal(keys);

      // only while openKeys increase
      if (changeType === 'increase') {
        const folderId = keys?.length ? keys[keys.length - 1] : undefined;

        if (currentFolderId !== folderId) {
          resetMenu();

          setCurrentFolderId(folderId);
          setSelectedKeys([folderId]);
        }
      }
    },
    [openKeys, currentFolderId]
  );

  const onSelect = useCallback(
    ({ key }) => {
      const fileId = key?.startsWith('file_') ? key : undefined;

      console.log('onSelect', fileId, key);

      if (!fileId) return;

      const folderId = getFolderIdByFileId(fileId, fileTree);

      resetMenu();

      const file = getFileById(fileId, fileTree);

      setCurrentFile(file);
      setCurrentFolderId(folderId);
      addSelectedKeys([key, folderId]);
    },
    [fileTree]
  );

  const onFileNameChange = useCallback(
    async (text: string, file: RevenoteFile) => {
      if (file.type === 'note') {
        await blocksuiteStorage.updatePageTitle(file.id, text);
      }
      await menuIndexeddbStorage.updateFileName(file, text);
      updateEditableTextState(file.id, true, editableTextState);

      setSelectedKeys([file.id]);

      await getFileTree();
    },
    [editableTextState]
  );

  const onFolderNameChange = useCallback(
    (folder: RevenoteFolder, text: string) => {
      menuIndexeddbStorage.updateFolderName(folder, text);
      updateEditableTextState(folder.id, true, editableTextState);
    },
    [editableTextState]
  );

  const onEditableTextEdit = useCallback(
    (id: string) => {
      updateEditableTextState(id, false, editableTextState);
    },
    [editableTextState]
  );

  return (
    <div className="revenote-menu-container">
      <div onClick={() => resetMenu()} className="mb-5">
        <RevenoteLogo size="small" className="pl-5" />
      </div>
      <OperationBar
        size="small"
        folderId={currentFolderId}
        onAdd={onFolderOrFileAdd}
        className="mb-3"
      />
      <div className="menu-list">
        <Menu
          theme="light"
          mode="inline"
          selectedKeys={selectedKeys}
          openKeys={openKeys}
          onOpenChange={onOpenChange}
          onSelect={onSelect}
          style={{ border: 'none' }}
          items={fileTree?.map((folder) => ({
            key: folder.id,
            icon: <Folder className="w-3" />,
            label: (
              <Dropdown menu={{ items: getFolderContextMenu(folder) }} trigger={['contextMenu']}>
                <div className="flex items-center justify-between">
                  <EditableText
                    isPreview={editableTextState[folder.id]}
                    text={folder.name}
                    defaultText="Untitled"
                    onSave={(text) => onFolderNameChange(folder, text)}
                    onEdit={() => onEditableTextEdit(folder.id)}
                  />
                </div>
              </Dropdown>
            ),
            children: folder?.children?.map((file) => {
              return {
                key: file.id,
                label: (
                  <Dropdown
                    menu={{ items: getFileContextMenu(file, folder) }}
                    trigger={['contextMenu']}
                  >
                    <div className="flex items-center justify-between">
                      <EditableText
                        isPreview={editableTextState[file.id]}
                        type={file.type}
                        text={file.name}
                        extraText={moment(file.gmtModified).format('YYYY-MM-DD HH:mm:ss')}
                        defaultText="Untitled"
                        onSave={(text) => onFileNameChange(text, file)}
                        onEdit={() => onEditableTextEdit(file.id)}
                      />
                    </div>
                  </Dropdown>
                )
              };
            })
          }))}
        />
      </div>
    </div>
  );
}
