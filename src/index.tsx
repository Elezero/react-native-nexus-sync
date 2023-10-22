import NetInfo, {
  type NetInfoState,
  type NetInfoSubscription,
} from '@react-native-community/netinfo';
import { useCallback, useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

export type NexusGenericPrimaryType = {
  [x: string]: any;
};

interface UseNexusSyncProps<T extends NexusGenericPrimaryType> {
  data: T[];
  setData: (val: T[]) => void;
  async_DATA_KEY: string;
  useMethodsOnly?: boolean;
  syncRemoteData?: boolean;
  syncLocalData?: boolean;
  consoleDebug?: boolean;
  idAttributeName?: keyof T;
  modificationDateAttributeName?: keyof T;
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
  const syncingData = useRef<boolean>(false);

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

  // LOCAL STORAGE KEYS MANAGING
  useEffect(() => {
    const checkAndSaveLocalKeys = async () => {
      AsyncStorage.getItem('NEXUSSYNC_KEYS').then((localKeysString) => {
        const localKeys = JSON.parse(localKeysString ?? '[]') as string[];
        if (!localKeys.includes(props.async_DATA_KEY)) {
          localKeys.push(props.async_DATA_KEY);
          AsyncStorage.setItem('NEXUSSYNC_KEYS', JSON.stringify(localKeys));
        }
      });
    };

    !props.useMethodsOnly && checkAndSaveLocalKeys();
  }, []);

  const deleteAllLocalSavedData = () => {
    AsyncStorage.getItem('NEXUSSYNC_KEYS').then((localKeysString) => {
      const localKeys = JSON.parse(localKeysString ?? '[]') as string[];

      localKeys.forEach((localKey) => {
        AsyncStorage.removeItem(localKey);
      });
    });
  };

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
    if (props.useMethodsOnly) {
      return;
    }
    if (
      !props.loadFirstRemote ||
      props.remoteMethods === undefined ||
      props.remoteMethods.GET === undefined
    ) {
      getLocalData();
    }
  }, []);

  useEffect(() => {
    if (props.data) {
      if (props.data.length > 0 && hasDataChanged.current) {
        updateLocalData();
      }
    }
  }, [props.data]);

  useEffect(() => {
    if (hasDeletedChanged.current) {
      updateLocalDataDeletedOffline();
    }
  }, [dataDeletedOffline]);

  /* 
			--- GETTING DATA FUNCTIONS --- 
	*/
  const getLocalData = useCallback(async () => {
    if (props.useMethodsOnly) {
      return;
    }

    AsyncStorage.getItem(props.async_DATA_KEY)
      .then((localDataString) => {
        if (localDataString) {
          try {
            const localData: T[] = JSON.parse(localDataString);

            props.setData(localData);
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
  }, [
    props.setData,
    props.async_DATA_KEY,
    props.useMethodsOnly,
    props.consoleDebug,
  ]);

  const syncEditedLocalItemsToRemote = useCallback(
    (
      dataToEdit: T[],
      dataWithoutChanges: T[],
      didSyncLocalDeletions: boolean
    ) => {
      if (props.useMethodsOnly) {
        return;
      }

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
              props.setData(itemsFinal);

              // setSyncingData(false)
              syncingData.current = false;
            })
            .catch((err: any) => {
              setIsRemoteDataUptoDate(didSyncLocalDeletions);
              setError(`ERROR NEXUSSYNC_010:` + JSON.stringify(err));
            });
        } else {
          setIsRemoteDataUptoDate(didSyncLocalDeletions);
          props.setData(dataWithoutChanges);
          // setSyncingData(false)
          syncingData.current = false;
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
        props.setData(dataWithoutChanges);
        // setSyncingData(false)
        syncingData.current = false;
      }
    },
    [
      props.remoteMethods,
      props.setData,
      numberOfChangesPending,
      props.useMethodsOnly,
      props.consoleDebug,
    ]
  );

  const syncCreatedLocalItemsToRemote = useCallback(
    (
      dataToCreate: T[],
      dataToEdit: T[],
      dataWithoutChanges: T[],
      didSyncLocalDeletions: boolean
    ) => {
      if (props.useMethodsOnly) {
        return;
      }

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
    [
      props.remoteMethods,
      numberOfChangesPending,
      props.useMethodsOnly,
      props.consoleDebug,
      syncEditedLocalItemsToRemote,
    ]
  );

  const syncDeletedLocalItemsToRemote = useCallback(
    (
      dataToDelete: string[],
      dataToCreate: T[],
      dataToEdit: T[],
      dataWithoutChanges: T[]
    ) => {
      if (props.useMethodsOnly) {
        return;
      }

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
                props.consoleDebug &&
                  console.log(`err C|=========>`, JSON.stringify(err));
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
        syncCreatedLocalItemsToRemote(
          dataToCreate,
          dataToEdit,
          itemsFinal,
          dataToDelete.length === 0
        );
      }
    },
    [
      props.remoteMethods,
      numberOfChangesPending,
      hasDeletedChanged.current,
      props.useMethodsOnly,
      props.consoleDebug,
      syncCreatedLocalItemsToRemote,
    ]
  );

  const compareLocalVsRemoteData = useCallback(
    (remoteData: T[], dataToDelete: string[]) => {
      if (props.useMethodsOnly) {
        return;
      }
      let dataToCreate: T[] = [];
      let dataToEdit: T[] = [];
      let dataWithoutChanges: T[] = [];

      let itemFound = false;
      let _hasDataChanged = false;

      AsyncStorage.getItem(props.async_DATA_KEY)
        .then((localDataString) => {
          if (localDataString) {
            console.log(
              `localDataString XXXXX|=========>`,
              JSON.stringify(localDataString)
            );
            console.log(
              `remoteData yyYYY|=========>`,
              JSON.stringify(remoteData)
            );
            try {
              const localData: T[] = JSON.parse(localDataString);

              if (localData.length > 0) {
                for (const localItem of localData) {
                  itemFound = false;

                  for (const remoteItem of remoteData) {
                    if (props.idAttributeName !== undefined) {
                      if (props.modificationDateAttributeName !== undefined) {
                        if (
                          localItem?.[props.idAttributeName] ==
                          remoteItem?.[props.idAttributeName]
                        ) {
                          itemFound = true;

                          if (
                            localItem?.[props.modificationDateAttributeName] ==
                            remoteItem?.[props.modificationDateAttributeName]
                          ) {
                            // Local and Remote item are exactly the same
                            dataWithoutChanges.push(localItem);
                            break;
                          } else {
                            // Different datetime
                            const modificationDateLocalString: string =
                              localItem?.[
                                props.modificationDateAttributeName
                              ] as string;

                            const modificationDateRemoteString: string =
                              remoteItem?.[
                                props.modificationDateAttributeName
                              ] as string;

                            const localItemModificationDate = new Date(
                              modificationDateLocalString
                            );
                            const remoteItemModificationDate = new Date(
                              modificationDateRemoteString
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
                        }
                      }
                    }
                  }

                  if (!itemFound) {
                    // Local item is not in remote
                    if (localItem?.createdOffline) {
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
                    if (
                      props.idAttributeName !== undefined &&
                      remoteItem?.[props.idAttributeName] ==
                        localItem?.[props.idAttributeName]
                    ) {
                      itemYa = true;
                    }
                  });

                  if (
                    props.idAttributeName !== undefined &&
                    !itemYa &&
                    !dataToDelete.includes(
                      remoteItem?.[props.idAttributeName] as string
                    )
                  ) {
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

          if (isOnline && props.syncRemoteData && !syncingData.current) {
            // setSyncingData(true)
            syncingData.current = true;
            setNumberOfChangesPending(
              dataToDelete.length + dataToCreate.length + dataToEdit.length
            );

            syncDeletedLocalItemsToRemote(
              dataToDelete,
              dataToCreate,
              dataToEdit,
              dataWithoutChanges
            );
          } else {
            props.setData(dataWithoutChanges);
          }
        })
        .catch((err: any) => {
          setError(`ERROR NEXUSSYNC_007:` + JSON.stringify(err));
        });
    },
    [
      props.async_DATA_KEY,
      isOnline,
      props.idAttributeName,
      props.modificationDateAttributeName,
      props.useMethodsOnly,
      props.consoleDebug,
      syncCreatedLocalItemsToRemote,
    ]
  );

  const getOfflineDeletedData = useCallback(
    (remoteData: T[]) => {
      if (props.useMethodsOnly) {
        return;
      }

      if (
        props.idAttributeName === undefined ||
        props.modificationDateAttributeName === undefined
      ) {
        props.consoleDebug &&
          console.warn(
            `WARNING NEXUSSYNC_002: No idAttributeName or modificationDateAttributeName 
					Attribute provided on hook initialization, it means that will this component will works offline 
					and will be updated always local data and display Remote data `
          );

        setIsLocalDataUptoDate(true);
        props.setData(remoteData);
        return;
      }

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
    [
      props.async_DATA_KEY,
      isOnline,
      props.idAttributeName,
      props.modificationDateAttributeName,
      props.setData,
      props.useMethodsOnly,
      props.consoleDebug,
      compareLocalVsRemoteData,
    ]
  );

  const getRemoteData = useCallback(() => {
    if (props.useMethodsOnly) {
      return;
    }

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
  }, [
    props.remoteMethods,
    setLoading,
    props.useMethodsOnly,
    props.consoleDebug,
    getOfflineDeletedData,
  ]);

  /* 
			--- REFRESH HANDLING --- 
	*/
  const refreshData = useCallback(() => {
    if (props.useMethodsOnly) {
      return;
    }
    if (!isOnline) {
      getLocalData && getLocalData();
    } else {
      getRemoteData && getRemoteData();
    }
    setBackOnLine(false);
  }, [
    isOnline,
    getLocalData,
    getRemoteData,
    setBackOnLine,
    props.useMethodsOnly,
    props.consoleDebug,
  ]);

  /* 
			--- HELPER FUNCTIONS  --- 
	*/
  const updateItemFromContext = useCallback(
    (id: string, new_item: T): T[] => {
      const updatedItems = props.data.map((item) => {
        if (props.idAttributeName && item?.[props.idAttributeName] == id) {
          let newItem: any = {
            ...new_item,
          };
          newItem[props.idAttributeName] = id;
          return newItem;
        }
        return item;
      });

      return updatedItems;
    },
    [props.data, props.idAttributeName]
  );

  const deleteItemFromContext = useCallback(
    (id: string): T[] => {
      if (props.idAttributeName !== undefined) {
        const updatedItems = props.data.filter(
          (item) => item?.[props.idAttributeName ?? 'id'] != id
        );
        return updatedItems;
      }
      return props.data;
    },
    [props.data, props.idAttributeName]
  );

  /* 
			--- ASYNC STORAGE FUNCTIONS --- 
	*/
  const updateLocalData = useCallback(async () => {
    console.log(`xxxxxXXX ABOUT TO SYNC LOCAL DATA | --------------`);
    console.log(`props.data |=========>`, JSON.stringify(props.data));
    await AsyncStorage.setItem(
      props.async_DATA_KEY,
      JSON.stringify(props.data)
    );
  }, [
    props.async_DATA_KEY,
    props.data,
    props.useMethodsOnly,
    props.consoleDebug,
  ]);

  const updateLocalDataDeletedOffline = useCallback(async () => {
    await AsyncStorage.setItem(
      props.async_DATA_KEY + '_deleted',
      JSON.stringify(dataDeletedOffline)
    );
  }, [
    props.async_DATA_KEY,
    dataDeletedOffline,
    props.useMethodsOnly,
    props.consoleDebug,
  ]);

  /* 
			--- EXPORTABLE CRUD FUNCTIONS --- 
	*/
  const saveItem = useCallback(
    async (item: T): Promise<T> => {
      setLoading(true);
      // CREATE ITEM

      if (isOnline && props.remoteMethods && props.remoteMethods.CREATE) {
        try {
          hasDataChanged.current = true;
          const createdItem = await props.remoteMethods.CREATE(item);
          props.setData([...props.data, createdItem]);
          setLoading(false);
          return createdItem;
        } catch (err: any) {
          setError(`ERROR NEXUSSYNC_011:` + JSON.stringify(err));
          setLoading(false);
          return Promise.reject(`ERROR NEXUSSYNC_011:` + JSON.stringify(err));
        }
      } else {
        // ONLY SAVE IN LOCAL OFFLINE

        if (
          props.idAttributeName !== undefined &&
          props.modificationDateAttributeName
        ) {
          const currentDate = new Date();
          const formattedDate = currentDate
            .toISOString()
            .slice(0, 19)
            .replace('T', ' ');

          hasDataChanged.current = true;

          let newItem: any = {
            ...item,
            createdOffline: true,
          };
          newItem[props.modificationDateAttributeName] = formattedDate;
          newItem[props.idAttributeName] = new Date().getTime().toString();

          props.setData([...props.data, newItem]);

          setLoading(false);
          return newItem;
        } else {
          console.warn(
            `WARNING NEXUSSYNC_003: No idAttributeName or modificationDateAttributeName 
						Attribute provided on hook initialization, can not create local item`
          );
          setLoading(false);
          return Promise.reject(`ERROR NEXUSSYNC_0133: unkpnw`);
        }
      }
    },
    [
      setLoading,
      isOnline,
      props.remoteMethods,
      props.setData,
      props.data,
      props.idAttributeName,
      props.modificationDateAttributeName,
    ]
  );

  const updateItem = useCallback(
    async (item: T): Promise<T> => {
      if (
        props.idAttributeName === undefined ||
        props.modificationDateAttributeName === undefined
      ) {
        console.warn(
          `WARNING NEXUSSYNC_006: Can not update item due to idAttributeName not provided on hook initialization`
        );
        setError(
          `WARNING NEXUSSYNC_006: Can not update item due to idAttributeName not provided on hook initialization`
        );
        return Promise.reject(
          'WARNING NEXUSSYNC_006: Can not update item due to idAttributeName not provided on hook initialization'
        );
      }

      setLoading(true);

      // UPDATE ITEM
      if (isOnline && props.remoteMethods && props.remoteMethods.UPDATE) {
        try {
          hasDataChanged.current = true;
          const updatedItem = await props.remoteMethods.UPDATE(item);
          props.setData(updateItemFromContext(updatedItem.id, updatedItem));

          setLoading(false);
          return updatedItem;
        } catch (err: any) {
          setError(`ERROR NEXUSSYNC_012:` + JSON.stringify(err));
          setLoading(false);
          return Promise.reject(`ERROR NEXUSSYNC_012:` + JSON.stringify(err));
        }
      } else {
        // ONLY SAVE IN LOCAL OFFLINE
        const currentDate = new Date();
        const formattedDate = currentDate
          .toISOString()
          .slice(0, 19)
          .replace('T', ' ');

        hasDataChanged.current = true;

        let editedItem: any = {
          ...item,
        };
        editedItem[props.modificationDateAttributeName] = formattedDate;

        props.setData(
          updateItemFromContext(
            item?.[props.idAttributeName] as string,
            editedItem
          )
        );

        setLoading(false);
        return editedItem;
      }
    },
    [
      setLoading,
      isOnline,
      props.remoteMethods,
      props.setData,
      updateItemFromContext,
      props.data,
      props.idAttributeName,
      props.modificationDateAttributeName,
    ]
  );

  const deleteItem = useCallback(
    async (item: T) => {
      if (props.idAttributeName === undefined) {
        console.warn(
          `WARNING NEXUSSYNC_001: Can not delete item due to idAttributeName not provided on hook initialization`
        );
        setError(
          `WARNING NEXUSSYNC_001: Can not delete item due to idAttributeName not provided on hook initialization`
        );
        return;
      }

      setLoading(true);

      if (
        isOnline &&
        props.remoteMethods &&
        props.remoteMethods.DELETE &&
        props.idAttributeName
      ) {
        try {
          hasDataChanged.current = true;
          await props.remoteMethods.DELETE(
            item?.[props.idAttributeName] as string
          );
          props.setData(
            deleteItemFromContext(item?.[props.idAttributeName] as string)
          );

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
        if (props.idAttributeName) {
          props.setData(
            deleteItemFromContext(item?.[props.idAttributeName] as string)
          );
          setDataDeletedOffline([
            ...dataDeletedOffline,
            item?.[props.idAttributeName] as string,
          ]);
        }

        setLoading(false);
      }
    },
    [
      setLoading,
      isOnline,
      props.remoteMethods,
      props.setData,
      updateItemFromContext,
      props.data,
      props.idAttributeName,
      dataDeletedOffline,
      deleteItemFromContext,
    ]
  );

  return {
    data: props.data,
    isLoading,
    syncingData,
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
    deleteAllLocalSavedData,
  };
}
