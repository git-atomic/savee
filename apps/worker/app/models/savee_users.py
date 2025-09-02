"""
Savee Users model for tracking Savee.com user profiles
"""
from sqlalchemy import Column, Integer, String, DateTime, Text, Boolean, JSON
from sqlalchemy.sql import func
from .base import Base


class SaveeUser(Base):
    """Represents a Savee.com user profile"""
    __tablename__ = "savee_users"

    id = Column(Integer, primary_key=True, autoincrement=True)
    username = Column(String(100), unique=True, nullable=False, index=True)
    display_name = Column(String(200), nullable=True)
    bio = Column(Text, nullable=True)
    profile_image_url = Column(String(500), nullable=True)
    cover_image_url = Column(String(500), nullable=True)
    profile_url = Column(String(500), nullable=False)
    
    # Statistics
    follower_count = Column(Integer, default=0)
    following_count = Column(Integer, default=0)
    saves_count = Column(Integer, default=0)
    collections_count = Column(Integer, default=0)
    
    # Profile metadata
    location = Column(String(200), nullable=True)
    website_url = Column(String(500), nullable=True)
    social_links = Column(JSON, nullable=True)  # Store social media links
    
    # Status and tracking
    is_verified = Column(Boolean, default=False)
    is_active = Column(Boolean, default=True)
    last_scraped_at = Column(DateTime(timezone=True), nullable=True)
    first_discovered_at = Column(DateTime(timezone=True), server_default=func.now())
    
    # Timestamps
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    def __repr__(self):
        return f"<SaveeUser(id={self.id}, username='{self.username}', display_name='{self.display_name}')>"


