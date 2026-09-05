from database import engine, Base
from models import *

def main():
    "Initialize the database tables"

    Base.metadata.create_all(bind=engine)
    print("Database tables created.")

if __name__ == "__main__":
    main()
