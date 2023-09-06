import NetInfo, {
  type NetInfoState,
  type NetInfoSubscription,
} from '@react-native-community/netinfo';
import { useCallback, useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

type NexusGenericPrimaryType = {
  [x: string]: any;
};

interface UseNexusSyncProps<T extends NexusGenericPrimaryType> {
  async_DATA_KEY: string;
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
      if (
        props.idAttributeName === undefined ||
        props.modificationDateAttributeName === undefined
      ) {
        console.warn(
          `WARNING NEXUSSYNC_002: No idAttributeName or modificationDateAttributeName 
					Attribute provided on hook initialization, it means that will this component will works offline 
					and will be updated always local data and display Remote data `
        );

        setIsLocalDataUptoDate(true);
        setData(remoteData);
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
    ]
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
    [
      props.async_DATA_KEY,
      isOnline,
      props.idAttributeName,
      props.modificationDateAttributeName,
    ]
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
        syncCreatedLocalItemsToRemote(
          dataToCreate,
          dataToEdit,
          itemsFinal,
          dataToDelete.length === 0
        );
      }
    },
    [props.remoteMethods, numberOfChangesPending, hasDeletedChanged.current]
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
    [props.remoteMethods, numberOfChangesPending]
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
    [props.remoteMethods, setData, numberOfChangesPending]
  );

  /* 
			--- HELPER FUNCTIONS  --- 
	*/
  const updateItemFromContext = useCallback(
    (id: string, new_item: T): T[] => {
      const updatedItems = data.map((item) => {
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
    [data, props.idAttributeName]
  );

  const deleteItemFromContext = useCallback(
    (id: string): T[] => {
      if (props.idAttributeName !== undefined) {
        const updatedItems = data.filter(
          (item) => item?.[props.idAttributeName ?? 'id'] != id
        );
        return updatedItems;
      }
      return data;
    },
    [data, props.idAttributeName]
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

          setData([...data, newItem]);

          setLoading(false);
        } else {
          console.warn(
            `WARNING NEXUSSYNC_003: No idAttributeName or modificationDateAttributeName 
						Attribute provided on hook initialization, can not create local item`
          );
          setLoading(false);
        }
      }
    },
    [
      setLoading,
      isOnline,
      props.remoteMethods,
      setData,
      data,
      props.idAttributeName,
      props.modificationDateAttributeName,
    ]
  );

  const updateItem = useCallback(
    async (item: T) => {
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
        return;
      }

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

        let editedItem: any = {
          ...item,
        };
        editedItem[props.modificationDateAttributeName] = formattedDate;

        setData(
          updateItemFromContext(
            item?.[props.idAttributeName] as string,
            editedItem
          )
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
          setData(
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
          setData(
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
      setData,
      updateItemFromContext,
      data,
      props.idAttributeName,
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
