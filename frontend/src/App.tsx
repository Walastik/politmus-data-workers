import { BrowserRouter, Route, Routes } from 'react-router-dom'

import Explorer from './pages/Explorer'
import WipLanding from './pages/WipLanding'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<WipLanding />} />
        <Route path="/dev-explorer" element={<Explorer />} />
        <Route path="*" element={<WipLanding />} />
      </Routes>
    </BrowserRouter>
  )
}
