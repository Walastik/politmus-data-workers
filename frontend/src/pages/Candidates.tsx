import CandidatesPanel from '../components/CandidatesPanel'
import PageHeader, { PageContainer } from '../components/PageHeader'
import { useDrawerLinks } from '../useDrawerLinks'

export default function Candidates() {
  const { openOfficial } = useDrawerLinks()
  return (
    <PageContainer>
      <PageHeader
        title="Candidates"
        description="Everyone running for Congress this cycle, by race, with where they stand and who funds them."
      />
      <CandidatesPanel onSelectOfficial={openOfficial} />
    </PageContainer>
  )
}
