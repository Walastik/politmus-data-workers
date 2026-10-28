import BillsFeed from '../BillsFeed'
import PageHeader, { PageContainer } from '../components/PageHeader'
import { useDrawerLinks } from '../useDrawerLinks'

export default function Bills() {
  const { openBill } = useDrawerLinks()
  return (
    <PageContainer>
      <PageHeader
        title="Bills"
        description="Legislation moving through Congress, with how each chamber and party voted."
      />
      <BillsFeed onSelectBill={openBill} />
    </PageContainer>
  )
}
