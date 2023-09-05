import NetInfo, {
  type NetInfoState,
  type NetInfoSubscription,
} from '@react-native-community/netinfo';
import { useCallback, useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

type NexusGenericPrimaryType = {
  id: string;
  modificationDate: string;
  createdOffline?: boolean;
};

interface UseNexusSyncProps<T extends NexusGenericPrimaryType> {
  async_DATA_KEY: string;
  loadFirstRemote?: boolean; // Will load local data by default
  autoRefreshOnBackOnline?: boolean;
  onBackOnline?: () => any;
  remoteMethods?: {
    GET?: () => Promise<T[]>;
    CREATE?: (item: T) => Promise<T>;
    UPDATE?: (item: T) => Promise<T>;
    DELETE?: (item: string) => Promise<string>;
  };
}

export default function useNexusSync<T extends NexusGenericPrimaryType>(
  props: UseNexusSyncProps<T>
) {
  const [isOnline, setIsOnline] = useState<boolean | null>(null);
  const [isLoading, setLoading] = useState<boolean>(false);
  const [data, setData] = useState<T[]>([]);
  const [error, setError] = useState<string | undefined>(undefined);
  const [isLocalDataUptoDate, setIsLocalDataUptoDate] = useState<
    boolean | undefined
  >(undefined);
  const [isRemoteDataUptoDate, setIsRemoteDataUptoDate] = useState<
    boolean | undefined
  >(undefined);
  const [numberOfChangesPending, setNumberOfChangesPending] = useState<
    number | undefined
  >(undefined);

  // CONTROL VARIABLES
  const [dataDeletedOffline, setDataDeletedOffline] = useState<string[]>([]);
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
    if (
      !props.loadFirstRemote ||
      props.remoteMethods === undefined ||
      props.remoteMethods.GET === undefined
    ) {
      getLocalData();
    }
  }, []);

  useEffect(() => {
    console.log(
      `isLocalDataUptoDate |=========>`,
      JSON.stringify(isLocalDataUptoDate)
    );
    console.log(
      `isRemoteDataUptoDate |=========>`,
      JSON.stringify(isRemoteDataUptoDate)
    );
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
              setError(`ERROR NEXUSSYNC_001:` + JSON.stringify(err));
            };
          }
        }
      })
      .catch((err: any) => {
        setError(`ERROR NEXUSSYNC_002:` + JSON.stringify(err));
      });
  }, [setData, props.async_DATA_KEY]);

  const getRemoteData = useCallback(() => {
    props.remoteMethods &&
      props.remoteMethods.GET &&
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
          setError(`ERROR NEXUSSYNC_003:` + JSON.stringify(err));
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
                setError(`ERROR NEXUSSYNC_005:` + JSON.stringify(err));
              };
            }
          }

          compareLocalVsRemoteData(remoteData, dataToDelete);
        })
        .catch((err: any) => {
          setError(`ERROR NEXUSSYNC_004:` + JSON.stringify(err));
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

                      if (
                        localItem.modificationDate ==
                        remoteItem.modificationDate
                      ) {
                        // Local and Remote item are exactly the same
                        dataWithoutChanges.push(localItem);
                        break;
                      } else {
                        // Different datetime
                        const localItemModificationDate = new Date(
                          localItem.modificationDate
                        );
                        const remoteItemModificationDate = new Date(
                          remoteItem.modificationDate
                        );

                        if (
                          localItemModificationDate > remoteItemModificationDate
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
                setError(`ERROR NEXUSSYNC_006:` + JSON.stringify(err));
              };
            }
          } else {
            // If there is nothing local will take all Remote
            dataWithoutChanges = remoteData;
            _hasDataChanged = true;
          }

          hasDataChanged.current = _hasDataChanged;
          setIsLocalDataUptoDate(true);

          if (isOnline) {
            setNumberOfChangesPending(
              dataToDelete.length + dataToCreate.length + dataToEdit.length
            );
            console.log(
              `NumberOfChangesPending |=========>`,
              JSON.stringify(
                dataToDelete.length + dataToCreate.length + dataToEdit.length
              )
            );
            console.log(
              `dataToDelete |=========>`,
              JSON.stringify(dataToDelete)
            );
            console.log(
              `dataToCreate |=========>`,
              JSON.stringify(dataToCreate)
            );
            console.log(`dataToEdit |=========>`, JSON.stringify(dataToEdit));

            syncDeletedLocalItemsToRemote(
              dataToDelete,
              dataToCreate,
              dataToEdit,
              dataWithoutChanges
            );
          }
        })
        .catch((err: any) => {
          setError(`ERROR NEXUSSYNC_007:` + JSON.stringify(err));
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

      if (props.remoteMethods && props.remoteMethods.DELETE) {
        if (dataToDelete.length > 0) {
          Promise.all(
            dataToDelete.map(async (item) => {
              try {
                const itemDeleted =
                  props.remoteMethods &&
                  props.remoteMethods.DELETE &&
                  props.remoteMethods.DELETE(item);

                return itemDeleted;
              } catch (err: any) {
                setError(`ERROR NEXUSSYNC_020:` + JSON.stringify(err));
                return null;
              }
            })
          )
            .then(() => {
              hasDeletedChanged.current = true;
              setDataDeletedOffline([]);

              if (numberOfChangesPending && numberOfChangesPending > 0) {
                setNumberOfChangesPending(
                  numberOfChangesPending - dataToDelete.length
                );
              }

              syncCreatedLocalItemsToRemote(
                dataToCreate,
                dataToEdit,
                itemsFinal,
                true
              );
            })
            .catch((err: any) => {
              setError(`ERROR NEXUSSYNC_008:` + JSON.stringify(err));
            });
        } else {
          syncCreatedLocalItemsToRemote(
            dataToCreate,
            dataToEdit,
            itemsFinal,
            true
          );
        }
      } else {
        // if (dataToDelete.length > 0) {
        // 	dataToDelete.map(itemx => {
        // 		if (itemx !== null && itemx !== undefined) {
        // 			dataWithoutChanges.push(itemx)
        // 		}
        // 	})
        // }

        syncCreatedLocalItemsToRemote(
          dataToCreate,
          dataToEdit,
          itemsFinal,
          dataToDelete.length === 0
        );
      }
    },
    [props.remoteMethods]
  );

  const syncCreatedLocalItemsToRemote = useCallback(
    (
      dataToCreate: T[],
      dataToEdit: T[],
      dataWithoutChanges: T[],
      didSyncLocalDeletions: boolean
    ) => {
      if (props.remoteMethods && props.remoteMethods.CREATE) {
        let itemsFinal = dataWithoutChanges;
        if (dataToCreate.length > 0) {
          Promise.all(
            dataToCreate.map(async (item) => {
              try {
                const itemCreated =
                  props.remoteMethods &&
                  props.remoteMethods.CREATE &&
                  props.remoteMethods.CREATE(item);

                return itemCreated;
              } catch (err: any) {
                setError(`ERROR NEXUSSYNC_021:` + JSON.stringify(err));
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

              if (numberOfChangesPending && numberOfChangesPending > 0) {
                setNumberOfChangesPending(
                  numberOfChangesPending - dataToCreate.length
                );
              }

              syncEditedLocalItemsToRemote(
                dataToEdit,
                itemsFinal,
                didSyncLocalDeletions && true
              );
            })
            .catch((err: any) => {
              setError(`ERROR NEXUSSYNC_009:` + JSON.stringify(err));
            });
        } else {
          syncEditedLocalItemsToRemote(
            dataToEdit,
            itemsFinal,
            didSyncLocalDeletions && true
          );
        }
      } else {
        if (dataToCreate.length > 0) {
          dataToCreate.map((itemx) => {
            if (itemx !== null && itemx !== undefined) {
              dataWithoutChanges.push(itemx);
            }
          });
        }

        syncEditedLocalItemsToRemote(
          dataToEdit,
          dataWithoutChanges,
          didSyncLocalDeletions && dataToCreate.length === 0
        );
      }
    },
    [props.remoteMethods]
  );

  const syncEditedLocalItemsToRemote = useCallback(
    (
      dataToEdit: T[],
      dataWithoutChanges: T[],
      didSyncLocalDeletions: boolean
    ) => {
      if (props.remoteMethods && props.remoteMethods.UPDATE) {
        if (dataToEdit.length > 0) {
          let itemsFinal = dataWithoutChanges;
          Promise.all(
            dataToEdit.map(async (itemToEdit) => {
              try {
                const itemEdited =
                  props.remoteMethods &&
                  props.remoteMethods.UPDATE &&
                  props.remoteMethods.UPDATE(itemToEdit);

                return itemEdited;
              } catch (err: any) {
                setError(`ERROR NEXUSSYNC_022:` + JSON.stringify(err));
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

              if (numberOfChangesPending && numberOfChangesPending > 0) {
                setNumberOfChangesPending(
                  numberOfChangesPending - dataToEdit.length
                );
              }

              setIsRemoteDataUptoDate(didSyncLocalDeletions);
              setData(itemsFinal);
            })
            .catch((err: any) => {
              setIsRemoteDataUptoDate(didSyncLocalDeletions);
              setError(`ERROR NEXUSSYNC_010:` + JSON.stringify(err));
            });
        } else {
          setIsRemoteDataUptoDate(didSyncLocalDeletions);
          setData(dataWithoutChanges);
        }
      } else {
        if (dataToEdit.length > 0) {
          dataToEdit.map((itemx) => {
            if (itemx !== null && itemx !== undefined) {
              dataWithoutChanges.push(itemx);
            }
          });
        }

        setIsRemoteDataUptoDate(
          didSyncLocalDeletions && dataToEdit.length === 0
        );
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
      if (isOnline && props.remoteMethods && props.remoteMethods.CREATE) {
        try {
          hasDataChanged.current = true;
          const createdItem = await props.remoteMethods.CREATE(item);
          setData([...data, createdItem]);
          setLoading(false);
        } catch {
          (err: any) => {
            setError(`ERROR NEXUSSYNC_011:` + JSON.stringify(err));
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
      if (isOnline && props.remoteMethods && props.remoteMethods.UPDATE) {
        try {
          hasDataChanged.current = true;
          const updatedItem = await props.remoteMethods.UPDATE(item);
          setData([...data, updatedItem]);
          setLoading(false);
        } catch {
          (err: any) => {
            setError(`ERROR NEXUSSYNC_012:` + JSON.stringify(err));
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
      if (isOnline && props.remoteMethods && props.remoteMethods.DELETE) {
        try {
          hasDataChanged.current = true;
          await props.remoteMethods.DELETE(item.id);
          setData(deleteItemFromContext(item.id));
          setLoading(false);
        } catch {
          (err: any) => {
            setError(`ERROR NEXUSSYNC_013:` + JSON.stringify(err));
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
    isLocalDataUptoDate,
    isRemoteDataUptoDate,
    numberOfChangesPending,
    refreshData,
    saveItem,
    updateItem,
    deleteItem,
    getRemoteData,
  };
}
