import unittest

from services.vote_questions import (
    VOTE_KIND_AMENDMENT,
    VOTE_KIND_OTHER,
    VOTE_KIND_PASSAGE,
    VOTE_KIND_PROCEDURAL,
    vote_kind,
)


class VoteKindTests(unittest.TestCase):
    def test_kinds(self):
        for question, kind in (
            ("On Passage of the Bill H.R. 1", VOTE_KIND_PASSAGE),
            ("On Motion to Suspend the Rules and Pass, as Amended", VOTE_KIND_PASSAGE),
            ("On the Motion (Motion to Concur in the House Amendment to S. 5)", VOTE_KIND_PASSAGE),
            ("On Cloture on the Motion to Proceed H.R. 9340", VOTE_KIND_PROCEDURAL),
            ("On the Cloture Motion H.R. 1", VOTE_KIND_PROCEDURAL),
            ("On the Motion to Table S.Amdt. 12", VOTE_KIND_PROCEDURAL),
            ("On the Motion (Motion to Waive All Applicable Budgetary Discipline Re: Lee Amdt. No. 5804)",
             VOTE_KIND_PROCEDURAL),
            ("On Motion to Recommit", VOTE_KIND_PROCEDURAL),
            ("On the Amendment S.Amdt. 2360 to H.R. 1", VOTE_KIND_AMENDMENT),
            ("On Agreeing to the Amendment", VOTE_KIND_AMENDMENT),
            ("On the Nomination PN 12", VOTE_KIND_OTHER),
            ("", VOTE_KIND_OTHER),
            (None, VOTE_KIND_OTHER),
        ):
            self.assertEqual(vote_kind(question), kind, question)


if __name__ == "__main__":
    unittest.main()
