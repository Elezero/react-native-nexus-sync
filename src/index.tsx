import NetInfo, {
  type NetInfoState,
  type NetInfoSubscription,
} from '@react-native-community/netinfo';
import { useCallback, useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

type NexusGenericPrimaryType = {
  id: string;
  version: number;
  modificationDate: string;
  createdOffline?: boolean;
};

interface UseNexusSyncProps<T extends NexusGenericPrimaryType> {
  async_DATA_KEY: string;
  loadFirstRemote?: boolean; // Will load local data by default
  autoRefreshOnBackOnline?: boolean;
  onBackOnline?: () => any;
  remoteMethods?: {
    GET: () => Promise<T[]>;
    CREATE: (item: T) => Promise<T>;
    UPDATE: (item: T) => Promise<T>;
    DELETE: (item: string) => Promise<string>;
  };
}

export default function useNexusSync<T extends NexusGenericPrimaryType>(
  props: UseNexusSyncProps<T>
) {
  const [isOnline, setIsOnline] = useState<boolean | null>(null);
  const [isLoading, setLoading] = useState<boolean>(false);
  const [data, setData] = useState<T[]>([]);
  const [error, setError] = useState<string | undefined>(undefined);
  const [dataDeletedOffline, setDataDeletedOffline] = useState<string[]>([]);

  // CONTROL VARIABLES
  const [backOnLine, setBackOnLine] = useState<boolean>(false);
  const hasDataChanged = useRef(false);
  const hasDeletedChanged = useRef(false);
  const alreadyRemoteLoaded = useRef(false);

  // NETWORK LISTENER
  useEffect(() => {
    const unsubscribe: NetInfoSubscription = NetInfo.addEventListener(
      (state: NetInfoState) => {
        if (state.isConnected !== null) {
          setIsOnline(state.isConnected);
        }
      }
    );
    return () => {
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (isOnline === null) {
      return;
    }
    if (!isOnline) {
      // HERE THE MANUAL HANDLE FUNCTION
      setBackOnLine(true);
      return;
    }

    // HERE THE AUTOMATIC HANDLE FUNCTION
    if (props.autoRefreshOnBackOnline || !alreadyRemoteLoaded.current) {
      getRemoteData();
    }

    props.onBackOnline && props.onBackOnline();
  }, [isOnline]);

  /* 
			--- IMPORTANT USE EFFECTS --- 
	*/
  useEffect(() => {
    if (!props.loadFirstRemote || props.remoteMethods === undefined) {
      getLocalData();
    }
  }, []);

  useEffect(() => {
    if (data.length > 0 && hasDataChanged.current) {
      updateLocalData();
    }
  }, [data]);

  useEffect(() => {
    if (hasDeletedChanged.current) {
      updateLocalDataDeletedOffline();
    }
  }, [dataDeletedOffline]);

  /* 
			--- GETTING DATA FUNCTIONS --- 
	*/
  const getLocalData = useCallback(async () => {
    AsyncStorage.getItem(props.async_DATA_KEY)
      .then((localDataString) => {
        if (localDataString) {
          try {
            const localData: T[] = JSON.parse(localDataString);
            setData(localData);
          } catch {
            (err: any) => {
              setError(`ERROR 001:` + JSON.stringify(err));
            };
          }
        }
      })
      .catch((err: any) => {
        setError(`ERROR 002:` + JSON.stringify(err));
      });
  }, [setData, props.async_DATA_KEY]);

  const getRemoteData = useCallback(() => {
    props.remoteMethods &&
      props.remoteMethods
        .GET()
        .then((res) => {
          alreadyRemoteLoaded.current = true;
          getOfflineDeletedData(res);
        })
        .finally(() => {
          setLoading(false);
        })
        .catch((err: any) => {
          setError(`ERROR 003:` + JSON.stringify(err));
        });
  }, [props.remoteMethods, setLoading]);

  const getOfflineDeletedData = useCallback(
    (remoteData: T[]) => {
      let dataToDelete: string[] = [];

      AsyncStorage.getItem(props.async_DATA_KEY + '_deleted')
        .then((localDataDeletedOfflineString) => {
          if (localDataDeletedOfflineString) {
            try {
              dataToDelete = JSON.parse(localDataDeletedOfflineString);
              hasDataChanged.current = true;
            } catch {
              (err: any) => {
                setError(`ERROR 005:` + JSON.stringify(err));
              };
            }
          }

          compareLocalVsRemoteData(remoteData, dataToDelete);
        })
        .catch((err: any) => {
          setError(`ERROR 004:` + JSON.stringify(err));
          compareLocalVsRemoteData(remoteData, []);
        });
    },
    [props.async_DATA_KEY, isOnline]
  );

  const compareLocalVsRemoteData = useCallback(
    (remoteData: T[], dataToDelete: string[]) => {
      let dataToCreate: T[] = [];
      let dataToEdit: T[] = [];
      let dataWithoutChanges: T[] = [];

      let itemFound = false;
      let _hasDataChanged = false;

      AsyncStorage.getItem(props.async_DATA_KEY)
        .then((localDataString) => {
          if (localDataString) {
            try {
              const localData: T[] = JSON.parse(localDataString);

              if (localData.length > 0) {
                for (const localItem of localData) {
                  itemFound = false;

                  for (const remoteItem of remoteData) {
                    if (localItem.id == remoteItem.id) {
                      itemFound = true;
                      if (localItem.version == remoteItem.version) {
                        if (
                          localItem.modificationDate ==
                          remoteItem.modificationDate
                        ) {
                          // Local and Remote item are exactly the same
                          dataWithoutChanges.push(localItem);
                          break;
                        } else {
                          // Same version but different datetime
                          const localItemModificationDate = new Date(
                            localItem.modificationDate
                          );
                          const remoteItemModificationDate = new Date(
                            remoteItem.modificationDate
                          );

                          if (
                            localItemModificationDate >
                            remoteItemModificationDate
                          ) {
                            // Local modification datetime is more recent
                            // Will upload local changes to remote
                            dataToEdit.push(localItem);
                          } else {
                            // Remote modification datetime is more recent
                            // Will update local item
                            dataWithoutChanges.push(remoteItem);
                            _hasDataChanged = true;
                          }
                        }
                      } else {
                        // Local and Remote versions are different
                        if (localItem.version > remoteItem.version) {
                          // Local version is more recent
                          // Will upload the local item changes to remote
                          dataToEdit.push(localItem);
                        } else {
                          // Remote version is more recent
                          // Will update local item
                          dataWithoutChanges.push(remoteItem);
                          _hasDataChanged = true;
                        }
                      }
                    }
                  }

                  if (!itemFound) {
                    // Local item is not in remote
                    if (localItem.createdOffline) {
                      // Was created offile, will be created to Remote
                      dataToCreate.push(localItem);
                    } else {
                      // Was deleted from Remote, will be deleted from Local and won't be created on Remote
                      _hasDataChanged = true;
                    }
                  }
                }

                // Checking which are in Remote but not in local
                let itemYa = false;
                remoteData.map((remoteItem) => {
                  itemYa = false;
                  localData.map((localItem) => {
                    if (remoteItem.id == localItem.id) {
                      itemYa = true;
                    }
                  });

                  if (!itemYa && !dataToDelete.includes(remoteItem.id)) {
                    // this item is not in local
                    dataWithoutChanges.push(remoteItem);
                    _hasDataChanged = true;
                  }
                });
              } else {
                // If there is nothing local will take all Remote
                dataWithoutChanges = remoteData;
                _hasDataChanged = true;
              }
            } catch {
              (err: any) => {
                setError(`ERROR 006:` + JSON.stringify(err));
              };
            }
          } else {
            // If there is nothing local will take all Remote
            dataWithoutChanges = remoteData;
            _hasDataChanged = true;
          }

          hasDataChanged.current = _hasDataChanged;

          if (isOnline) {
            syncDeletedLocalItemsToRemote(
              dataToDelete,
              dataToCreate,
              dataToEdit,
              dataWithoutChanges
            );
          }
        })
        .catch((err: any) => {
          setError(`ERROR 007:` + JSON.stringify(err));
        });
    },
    [props.async_DATA_KEY, isOnline]
  );

  /* 
			--- REFRESH HANDLING --- 
	*/
  const refreshData = useCallback(() => {
    if (isOnline) {
      getLocalData && getLocalData();
    } else {
      getRemoteData && getRemoteData();
    }
    setBackOnLine(false);
  }, [isOnline, getLocalData, getRemoteData, setBackOnLine]);

  /* 
			--- SYNC METHODS --- 
	*/
  const syncDeletedLocalItemsToRemote = useCallback(
    (
      dataToDelete: string[],
      dataToCreate: T[],
      dataToEdit: T[],
      dataWithoutChanges: T[]
    ) => {
      let itemsFinal = dataWithoutChanges;

      if (dataToDelete.length > 0) {
        Promise.all(
          dataToDelete.map(async (item) => {
            try {
              const itemDeleted =
                props.remoteMethods && props.remoteMethods.DELETE(item);

              return itemDeleted;
            } catch (err: any) {
              setError(`ERROR 020:` + JSON.stringify(err));
              return null;
            }
          })
        )
          .then(() => {
            hasDeletedChanged.current = true;
            setDataDeletedOffline([]);
            syncCreatedLocalItemsToRemote(dataToCreate, dataToEdit, itemsFinal);
          })
          .catch((err: any) => {
            setError(`ERROR 008:` + JSON.stringify(err));
          });
      } else {
        syncCreatedLocalItemsToRemote(dataToCreate, dataToEdit, itemsFinal);
      }
    },
    [props.remoteMethods]
  );

  const syncCreatedLocalItemsToRemote = useCallback(
    (dataToCreate: T[], dataToEdit: T[], dataWithoutChanges: T[]) => {
      let itemsFinal = dataWithoutChanges;

      if (dataToCreate.length > 0) {
        Promise.all(
          dataToCreate.map(async (item) => {
            try {
              const itemCreated =
                props.remoteMethods && props.remoteMethods.CREATE(item);

              return itemCreated;
            } catch (err: any) {
              setError(`ERROR 021:` + JSON.stringify(err));
              return null;
            }
          })
        )
          .then((itemsCreated) => {
            hasDataChanged.current = true;
            const filteredItemsCreated: (T | null | undefined)[] =
              itemsCreated.filter((item) => item !== null);
            filteredItemsCreated.map((itemx) => {
              if (itemx !== null && itemx !== undefined) {
                itemsFinal.push(itemx);
              }
            });

            syncEditedLocalItemsToRemote(dataToEdit, itemsFinal);
          })
          .catch((err: any) => {
            setError(`ERROR 009:` + JSON.stringify(err));
          });
      } else {
        syncEditedLocalItemsToRemote(dataToEdit, itemsFinal);
      }
    },
    [props.remoteMethods]
  );

  const syncEditedLocalItemsToRemote = useCallback(
    (dataToEdit: T[], dataWithoutChanges: T[]) => {
      if (dataToEdit.length > 0) {
        let itemsFinal = dataWithoutChanges;
        Promise.all(
          dataToEdit.map(async (itemToEdit) => {
            try {
              const itemEdited =
                props.remoteMethods && props.remoteMethods.UPDATE(itemToEdit);

              return itemEdited;
            } catch (err: any) {
              setError(`ERROR 022:` + JSON.stringify(err));
              return null;
            }
          })
        )
          .then((itemsCreated) => {
            hasDataChanged.current = true;
            const filteredItemsCreated: (T | null | undefined)[] =
              itemsCreated.filter((item) => item !== null);
            filteredItemsCreated.map((itemx) => {
              if (itemx !== null && itemx !== undefined) {
                itemsFinal.push(itemx);
              }
            });

            setData(itemsFinal);
          })
          .catch((err: any) => {
            setError(`ERROR 010:` + JSON.stringify(err));
          });
      } else {
        setData(dataWithoutChanges);
      }
    },
    [props.remoteMethods, setData]
  );

  /* 
			--- HELPER FUNCTIONS  --- 
	*/
  const updateItemFromContext = useCallback(
    (id: string, new_item: T): T[] => {
      const updatedItems = data.map((item) => {
        if (item.id == id) {
          return { ...new_item, id: item.id };
        }
        return item;
      });

      return updatedItems;
    },
    [data]
  );

  const deleteItemFromContext = useCallback(
    (id: string): T[] => {
      const updatedItems = data.filter((item) => item.id != id);
      return updatedItems;
    },
    [data]
  );

  /* 
			--- ASYNC STORAGE FUNCTIONS --- 
	*/
  const updateLocalData = useCallback(async () => {
    await AsyncStorage.setItem(props.async_DATA_KEY, JSON.stringify(data));
  }, [props.async_DATA_KEY, data]);

  const updateLocalDataDeletedOffline = useCallback(async () => {
    await AsyncStorage.setItem(
      props.async_DATA_KEY + '_deleted',
      JSON.stringify(dataDeletedOffline)
    );
  }, [props.async_DATA_KEY, dataDeletedOffline]);

  /* 
			--- EXPORTABLE CRUD FUNCTIONS --- 
	*/
  const saveItem = useCallback(
    async (item: T) => {
      setLoading(true);
      // CREATE ITEM
      if (isOnline && props.remoteMethods) {
        try {
          hasDataChanged.current = true;
          const createdItem = await props.remoteMethods.CREATE(item);
          setData([...data, createdItem]);
          setLoading(false);
        } catch {
          (err: any) => {
            setError(`ERROR 011:` + JSON.stringify(err));
            setLoading(false);
          };
        }
        setLoading(false);
      } else {
        // ONLY SAVE IN LOCAL OFFLINE
        const currentDate = new Date();
        const formattedDate = currentDate
          .toISOString()
          .slice(0, 19)
          .replace('T', ' ');

        hasDataChanged.current = true;

        setData([
          ...data,
          {
            ...item,
            id: new Date().getTime(),
            createdOffline: true,
            modificationDate: formattedDate,
          },
        ]);

        setLoading(false);
      }
    },
    [setLoading, isOnline, props.remoteMethods, setData, data]
  );

  const updateItem = useCallback(
    async (item: T) => {
      setLoading(true);

      // UPDATE ITEM
      if (isOnline && props.remoteMethods) {
        try {
          hasDataChanged.current = true;
          const updatedItem = await props.remoteMethods.UPDATE(item);
          setData([...data, updatedItem]);
          setLoading(false);
        } catch {
          (err: any) => {
            setError(`ERROR 012:` + JSON.stringify(err));
            setLoading(false);
          };
        }
      } else {
        // ONLY SAVE IN LOCAL OFFLINE
        const currentDate = new Date();
        const formattedDate = currentDate
          .toISOString()
          .slice(0, 19)
          .replace('T', ' ');

        hasDataChanged.current = true;
        setData(
          updateItemFromContext(item.id, {
            ...item,
            version: Number.parseInt(item.version.toString()) + 1,
            modificationDate: formattedDate,
          })
        );

        setLoading(false);
      }
    },
    [
      setLoading,
      isOnline,
      props.remoteMethods,
      setData,
      updateItemFromContext,
      data,
    ]
  );

  const deleteItem = useCallback(
    async (item: T) => {
      setLoading(true);
      if (isOnline && props.remoteMethods) {
        try {
          hasDataChanged.current = true;
          await props.remoteMethods.DELETE(item.id);
          setData(deleteItemFromContext(item.id));
          setLoading(false);
        } catch {
          (err: any) => {
            setError(`ERROR 013:` + JSON.stringify(err));
            setLoading(false);
          };
        }
      } else {
        // ONLY IN LOCAL OFFLINE
        hasDataChanged.current = true;
        hasDeletedChanged.current = true;
        setData(deleteItemFromContext(item.id));
        setDataDeletedOffline([...dataDeletedOffline, item.id]);
        setLoading(false);
      }
    },
    [
      setLoading,
      isOnline,
      props.remoteMethods,
      setData,
      updateItemFromContext,
      data,
    ]
  );

  return {
    data,
    isLoading,
    isOnline,
    error,
    backOnLine,
    refreshData,
    saveItem,
    updateItem,
    deleteItem,
    getRemoteData,
  };
}
