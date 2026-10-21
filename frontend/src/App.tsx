import { BrowserRouter, Route, Routes } from 'react-router-dom'

import Explorer from './pages/Explorer'
import Feed from './pages/Feed'
import Landing from './pages/Landing'
import WipLanding from './pages/WipLanding'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<WipLanding />} />
        <Route path="/landing" element={<Landing />} />
        <Route path="/dev-explorer" element={<Explorer />} />
        <Route path="/feed" element={<Feed />} />
        <Route path="*" element={<WipLanding />} />
      </Routes>
    </BrowserRouter>
  )
}
