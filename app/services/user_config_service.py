"""
User Configuration Service - Manages user-level Jira and GitHub configuration.
Handles encryption/decryption of sensitive data before storing in S3.
"""
import json
import logging
from datetime import datetime
from typing import Optional

import boto3
from botocore.exceptions import ClientError

from app.core.config import settings
from app.graph.state import UserConfiguration
from app.services.encryption_service import get_encryption_service

logger = logging.getLogger(__name__)

# Fields that should be encrypted before storage
ENCRYPTED_FIELDS = ["jira_api_token", "github_token"]


class UserConfigService:
    """Service for managing user configuration with encrypted credentials."""
    
    def __init__(self):
        self.s3_client = boto3.client(
            "s3",
            aws_access_key_id=settings.AWS_ACCESS_KEY_ID,
            aws_secret_access_key=settings.AWS_SECRET_ACCESS_KEY,
            region_name=settings.AWS_REGION,
            verify=False
        )
        self.bucket = settings.SDLC_STATE_BUCKET
        
        # Initialize encryption service
        if not settings.ENCRYPTION_KEY:
            logger.warning("ENCRYPTION_KEY not set - sensitive data will not be encrypted!")
            self.encryption_service = None
        else:
            self.encryption_service = get_encryption_service(settings.ENCRYPTION_KEY)
    
    def _get_config_key(self, username: str) -> str:
        """Generate S3 key for user configuration."""
        return f"users/{username}/config.json"
    
    def _encrypt_sensitive_fields(self, config_dict: dict) -> dict:
        """Encrypt sensitive fields in configuration."""
        if not self.encryption_service:
            logger.warning("Encryption service not available - storing data unencrypted")
            return config_dict
        
        encrypted_config = config_dict.copy()
        for field in ENCRYPTED_FIELDS:
            if field in encrypted_config and encrypted_config[field]:
                try:
                    encrypted_config[field] = self.encryption_service.encrypt(encrypted_config[field])
                except Exception as e:
                    logger.error(f"Failed to encrypt field {field}: {e}")
                    raise
        
        return encrypted_config
    
    def _decrypt_sensitive_fields(self, config_dict: dict) -> dict:
        """Decrypt sensitive fields in configuration."""
        if not self.encryption_service:
            logger.warning("Encryption service not available - returning data as-is")
            return config_dict
        
        decrypted_config = config_dict.copy()
        for field in ENCRYPTED_FIELDS:
            if field in decrypted_config and decrypted_config[field]:
                try:
                    decrypted_config[field] = self.encryption_service.decrypt(decrypted_config[field])
                except Exception as e:
                    logger.error(f"Failed to decrypt field {field}: {e}")
                    # Return empty string if decryption fails (might be unencrypted legacy data)
                    decrypted_config[field] = ""
        
        return decrypted_config
    
    def config_exists(self, username: str) -> bool:
        """
        Check if user configuration exists.
        
        Args:
            username: Username to check
            
        Returns:
            True if configuration exists, False otherwise
        """
        try:
            self.s3_client.head_object(
                Bucket=self.bucket,
                Key=self._get_config_key(username)
            )
            return True
        except ClientError as e:
            if e.response['Error']['Code'] == '404':
                return False
            logger.error(f"Error checking config existence for {username}: {e}")
            raise
    
    def get_user_config(self, username: str) -> Optional[UserConfiguration]:
        """
        Retrieve user configuration from S3 (with decryption).
        
        Args:
            username: Username to fetch configuration for
            
        Returns:
            UserConfiguration object or None if not found
        """
        try:
            response = self.s3_client.get_object(
                Bucket=self.bucket,
                Key=self._get_config_key(username)
            )
            
            # Parse JSON
            config_data = json.loads(response['Body'].read().decode('utf-8'))
            
            # Decrypt sensitive fields
            decrypted_data = self._decrypt_sensitive_fields(config_data)
            
            # Return as UserConfiguration object
            return UserConfiguration(**decrypted_data)
            
        except ClientError as e:
            if e.response['Error']['Code'] == 'NoSuchKey':
                logger.info(f"No configuration found for user: {username}")
                return None
            logger.error(f"Failed to retrieve config for {username}: {e}")
            raise
        except Exception as e:
            logger.error(f"Error parsing config for {username}: {e}")
            raise
    
    def save_user_config(self, config: UserConfiguration) -> UserConfiguration:
        """
        Save user configuration to S3 (with encryption).
        
        Args:
            config: UserConfiguration object to save
            
        Returns:
            Saved UserConfiguration object with timestamps
        """
        try:
            # Set timestamps
            now = datetime.utcnow().isoformat() + "Z"
            if not config.created_at:
                config.created_at = now
            config.updated_at = now
            
            # Convert to dict
            config_dict = config.model_dump()
            
            # Encrypt sensitive fields
            encrypted_data = self._encrypt_sensitive_fields(config_dict)
            
            # Save to S3
            self.s3_client.put_object(
                Bucket=self.bucket,
                Key=self._get_config_key(config.username),
                Body=json.dumps(encrypted_data, indent=2),
                ContentType="application/json"
            )
            
            logger.info(f"Saved configuration for user: {config.username}")
            return config
            
        except Exception as e:
            logger.error(f"Failed to save config for {config.username}: {e}")
            raise
    
    def update_user_config(self, username: str, updates: dict) -> UserConfiguration:
        """
        Update specific fields in user configuration.
        
        Args:
            username: Username to update
            updates: Dictionary of fields to update
            
        Returns:
            Updated UserConfiguration object
        """
        # Get existing config
        existing_config = self.get_user_config(username)
        
        if not existing_config:
            raise ValueError(f"Configuration not found for user: {username}")
        
        # Update fields
        config_dict = existing_config.model_dump()
        config_dict.update(updates)
        
        # Create updated config object
        updated_config = UserConfiguration(**config_dict)
        
        # Save
        return self.save_user_config(updated_config)
    
    def delete_user_config(self, username: str) -> bool:
        """
        Delete user configuration from S3.
        
        Args:
            username: Username to delete configuration for
            
        Returns:
            True if deleted successfully
        """
        try:
            self.s3_client.delete_object(
                Bucket=self.bucket,
                Key=self._get_config_key(username)
            )
            logger.info(f"Deleted configuration for user: {username}")
            return True
            
        except Exception as e:
            logger.error(f"Failed to delete config for {username}: {e}")
            raise
    
    def get_decrypted_credentials(self, username: str) -> dict:
        """
        Get decrypted credentials for a user (for internal service use).
        
        Args:
            username: Username to fetch credentials for
            
        Returns:
            Dictionary with decrypted credentials
        """
        config = self.get_user_config(username)
        if not config:
            raise ValueError(f"No configuration found for user: {username}")
        
        return {
            "jira_base_url": config.jira_base_url,
            "jira_email": config.jira_email,
            "jira_api_token": config.jira_api_token,
            "github_token": config.github_token,
            "github_username": config.github_username,
            "github_default_branch": config.github_default_branch,
        }
