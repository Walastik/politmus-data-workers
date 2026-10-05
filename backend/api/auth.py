import os
from fastapi import Request, Depends, HTTPException, status
from fastapi.security import HTTPBearer
from clerk_backend_api import Clerk, AuthenticateRequestOptions

security = HTTPBearer()

# Initialize Clerk SDK
# Automatically uses CLERK_SECRET_KEY from environment if not provided explicitly,
# but we provide it here for clarity.
clerk = Clerk(bearer_auth=os.environ.get("CLERK_SECRET_KEY", ""))

async def get_current_user(request: Request, _ = Depends(security)):
    """
    Verify the incoming Clerk JWT. Returns the request state if valid,
    otherwise raises a 401 Unauthorized exception.
    """
    # Optional: For networkless verification, use CLERK_JWT_KEY if set
    jwt_key = os.environ.get("CLERK_JWT_KEY")
    options = AuthenticateRequestOptions(jwt_key=jwt_key) if jwt_key else AuthenticateRequestOptions()
    
    try:
        # Clerk SDK authenticates the FastAPI request
        request_state = clerk.authenticate_request(request, options)
        
        if not request_state.is_signed_in:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail=request_state.message or "Unauthenticated request",
                headers={"WWW-Authenticate": "Bearer"},
            )
        return request_state
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=str(e),
            headers={"WWW-Authenticate": "Bearer"},
        )
