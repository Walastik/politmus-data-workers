import HappeningNow from '../components/HappeningNow'
import { PageContainer } from '../components/PageHeader'
import { useDrawerLinks } from '../useDrawerLinks'

export default function Now() {
  const { openOfficial, openBill } = useDrawerLinks()
  return (
    <PageContainer narrow>
      <h1 className="sr-only">Happening Now</h1>
      <HappeningNow onSelectOfficial={openOfficial} onSelectBill={openBill} />
    </PageContainer>
  )
}
