# react-native-nexus-sync

![alt text](https://elesteam.com/public_images/nexus_logo.png)

Library that makes your App works Offline with auto Sync

## Installation

```sh
npm install react-native-nexus-sync
```

## Usage

```js
import useNexusSync from 'react-native-nexus-sync';
```

## Example

```js
import React, {useState} from 'react'
import {FlatList} from 'react-native'

// API
import backendService from '../api/service'
import {Note} from '../models/note'
import {AxiosResponse} from 'axios'
import IDBGetNotesData from '../api/service/interfaces/IDBGetNotesData'
import {Text, TextInput, TouchableOpacity, View} from 'react-native'
import useNexusSync from 'react-native-nexus-sync'
import {ASYNC_STORAGE_KEY_NOTES} from '../config/values/asyncStorageKeys'
import IDBServiceRootResponse from '../api/service/interfaces/IDBServiceRootResponse'
import IDBCreateModifiedNoteData from '../api/service/interfaces/IDBCreateModifiedNoteData'

const MultipleItemsOffline = () => {
	const getItemsFromServer = async (): Promise<Note[]> => {
		console.log(`GETTING NOTES | --------------`)
		try {
			const _notesResponse = (await backendService.post(
				'/NotesGet.php',
				{}
			)) as AxiosResponse<IDBServiceRootResponse<IDBGetNotesData>>
			const _notes = _notesResponse.data.data.notes
			return _notes
		} catch {
			;(err: any) => {
				console.log(`err 23R|=========>`, JSON.stringify(err))
			}
		}
		return []
	}

	const createItemToServer = async (noteToCreate: Note): Promise<Note> => {
		const noteCreatedResponse = (await backendService.post('/NoteCreate.php', {
			title: noteToCreate.title
		})) as AxiosResponse<IDBServiceRootResponse<IDBCreateModifiedNoteData>>
		return {
			id: noteCreatedResponse.data.data.i_id,
			title: noteToCreate.title,
			status: noteToCreate.status,
			modificationDate: noteCreatedResponse.data.data.i_modificationDate
		}
	}

	const updateItemToServer = async (noteToUpdate: Note): Promise<Note> => {
		const noteEditedResponse = (await backendService.post('/NoteUpdate.php', {
			id: noteToUpdate.id,
			title: noteToUpdate.title,
			note_status: noteToUpdate.status
		})) as AxiosResponse<IDBServiceRootResponse<IDBCreateModifiedNoteData>>
		return {
			id: noteEditedResponse.data.data.i_id,
			title: noteToUpdate.title,
			status: noteToUpdate.status,
			modificationDate: noteEditedResponse.data.data.i_modificationDate
		}
	}

	const deleteItemToServer = async (noteToDelete: string): Promise<string> => {
		const noteEditedResponse = (await backendService.post('/NoteDelete.php', {
			id: noteToDelete
		})) as AxiosResponse<IDBServiceRootResponse<IDBCreateModifiedNoteData>>
		return noteToDelete
	}

	const {
		data: notes,
		isLoading,
		isOnline,
		backOnLine,
		refreshData,
		saveItem,
		updateItem,
		deleteItem
	} = useNexusSync<Note>({
		async_DATA_KEY: ASYNC_STORAGE_KEY_NOTES,
		onBackOnline: () => {
			console.log(`BACK ON LINE | --------------`)
		},
		autoRefreshOnBackOnline: true,
		remoteMethods: {
			GET: getItemsFromServer,
			CREATE: createItemToServer,
			UPDATE: updateItemToServer,
			DELETE: deleteItemToServer
		}
	})

	const [createEditModalVisible, setCreateEditModalVisible] = useState(false)
	const [workingNote, setWorkingNote] = useState<Note>({
		id: '0',
		title: '',
		status: 0,
		modificationDate: ''
	})

	return (
		<View style={{flex: 1}}>
			{!isOnline && (
				<View style={{backgroundColor: 'red'}}>
					<Text style={{alignContent: 'center', textAlign: 'center'}}>
						Offline mode
					</Text>
				</View>
			)}
			{isOnline && backOnLine && (
				<TouchableOpacity
					style={{
						backgroundColor: '#fbff00',
						padding: 20,
						marginBottom: 20,
						marginHorizontal: 20,
						borderRadius: 20
					}}
					onPress={() => {
						refreshData()
					}}>
					<Text style={{color: 'black'}}>REFRESH</Text>
				</TouchableOpacity>
			)}

			<TouchableOpacity
				style={{backgroundColor: 'blue', padding: 20, marginBottom: 20}}
				onPress={() => {
					setWorkingNote({
						id: '0',
						title: '',
						status: 0,
						modificationDate: ''
					})
					setCreateEditModalVisible(true)
				}}>
				<Text>NEW NOTE</Text>
			</TouchableOpacity>

			<FlatList
				onRefresh={() => {
					console.log(`REFRESHING | --------------`)
					refreshData()
				}}
				refreshing={isLoading}
				data={notes}
				numColumns={1}
				horizontal={false}
				keyExtractor={(item, index) => (index + 'x' + item.id).toString()}
				renderItem={({item, index}) => (
					<TouchableOpacity
						key={index + 'x' + item.id}
						style={{
							backgroundColor: '#2c2c2c',
							padding: 20,
							borderBottomColor: 'red',
							borderBottomWidth: 1
						}}
						onPress={() => {
							setWorkingNote(item)
							setCreateEditModalVisible(true)
						}}
						onLongPress={() => {
							deleteItem(item)
						}}>
						<View style={{}}>
							<Text style={{color: 'orange'}}>ID: {item.id} </Text>
							<Text style={{color: 'orange'}}>TITLE: {item.title}</Text>
							<Text style={{color: 'orange'}}>STATUS: {item.status}</Text>
							<Text style={{color: 'orange'}}>
								MOD DATE: {item.modificationDate}
							</Text>
						</View>
					</TouchableOpacity>
				)}
			/>

			{createEditModalVisible && (
				<View
					style={{
						position: 'absolute',
						backgroundColor: '#ff00004b',
						width: '100%',
						height: '100%'
					}}>
					<View>
						<Text style={{color: 'white', fontSize: 20}}>
							{workingNote ? 'Edit' : 'New'}
						</Text>
						<TextInput
							value={workingNote?.title}
							onChangeText={(val: string) => {
								setWorkingNote({...workingNote, title: val})
							}}
							style={{
								backgroundColor: 'white',
								marginVertical: 10,
								color: 'black'
							}}></TextInput>
					</View>
					<TouchableOpacity
						style={{backgroundColor: 'red', padding: 20, marginVertical: 10}}
						onPress={() => {
							setCreateEditModalVisible(false)
						}}>
						<Text>Close</Text>
					</TouchableOpacity>
					<TouchableOpacity
						style={{
							backgroundColor: '#0084ff',
							padding: 20,
							marginVertical: 10
						}}
						onPress={() => {
							if (workingNote.id === '0') {
								saveItem && saveItem(workingNote)
							} else {
								updateItem && updateItem(workingNote)
							}

							setCreateEditModalVisible(false)
						}}>
						<Text>{workingNote.id === '0' ? 'CREATE' : 'UPDATE'}</Text>
					</TouchableOpacity>
				</View>
			)}
		</View>
	)
}

export default MultipleItemsOffline

```

## Contributing

See the [contributing guide](CONTRIBUTING.md) to learn how to contribute to the repository and the development workflow.

## License

MIT

---

Made with [create-react-native-library](https://github.com/callstack/react-native-builder-bob)
