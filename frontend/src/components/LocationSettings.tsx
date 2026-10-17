import { useState } from 'react'

import { useSavedAddress } from '../useSavedAddress'

export default function LocationSettings() {
  const { isLoaded, canSave, savedAddress, saveAddress } = useSavedAddress()
  const [address, setAddress] = useState(savedAddress ?? '')
  const [isSaving, setIsSaving] = useState(false)
  const [saveSuccess, setSaveSuccess] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!isLoaded || !canSave) return

    setIsSaving(true)
    setSaveSuccess(false)

    try {
      await saveAddress(address)
      setSaveSuccess(true)
    } catch (err) {
      console.error('Failed to save address:', err)
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="p-4">
      <h3 className="mb-4 text-lg font-semibold">Location Settings</h3>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="address" className="block text-sm font-medium text-slate-300 mb-1">
            Saved Address
          </label>
          <input
            type="text"
            id="address"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="1600 Pennsylvania Avenue NW, Washington, DC"
            className="w-full rounded border border-slate-700 bg-slate-800 py-2 px-3 text-sm text-slate-100 focus:border-blue-500 focus:outline-none"
          />
        </div>
        <button
          type="submit"
          disabled={isSaving}
          className="rounded bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-500 disabled:opacity-50"
        >
          {isSaving ? 'Saving...' : 'Save Address'}
        </button>
        {saveSuccess && (
          <p className="mt-2 text-sm text-green-400">Address saved successfully!</p>
        )}
      </form>
    </div>
  )
}
