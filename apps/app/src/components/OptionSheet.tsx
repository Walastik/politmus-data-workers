import { FlatList, Modal, Pressable, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { Icons } from './icons'

// A full list of choices in a sheet (the native stand-in for a <select>).
export default function OptionSheet({
  visible,
  title,
  options,
  value,
  onSelect,
  onClose,
}: {
  visible: boolean
  title: string
  options: { value: string; label: string }[]
  value: string
  onSelect: (value: string) => void
  onClose: () => void
}) {
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView className="flex-1 bg-slate-900" edges={['top', 'bottom']}>
        <View className="flex-row items-center justify-between border-b border-slate-800 px-5 py-3">
          <Text className="text-base font-semibold text-slate-100">{title}</Text>
          <Pressable onPress={onClose} accessibilityRole="button" hitSlop={8}>
            <Text className="text-base font-semibold text-blue-400">Done</Text>
          </Pressable>
        </View>
        <FlatList
          data={options}
          keyExtractor={(option) => option.value || 'all'}
          renderItem={({ item }) => (
            <Pressable
              onPress={() => {
                onSelect(item.value)
                onClose()
              }}
              accessibilityRole="button"
              accessibilityState={{ selected: item.value === value }}
              className="flex-row items-center justify-between border-b border-slate-800/60 px-5 py-3 active:bg-slate-800"
            >
              <Text className={`text-base ${item.value === value ? 'font-semibold text-white' : 'text-slate-300'}`}>{item.label}</Text>
              {item.value === value ? <Icons.Check size={18} colorClassName="accent-blue-400" /> : null}
            </Pressable>
          )}
        />
      </SafeAreaView>
    </Modal>
  )
}
