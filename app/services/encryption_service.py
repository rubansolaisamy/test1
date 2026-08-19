"""
Encryption service for securing sensitive data before storing in S3.
Uses AES-256 encryption with Fernet (symmetric encryption).
"""
import base64
import logging
from cryptography.fernet import Fernet
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

logger = logging.getLogger(__name__)


class EncryptionService:
    """Handles encryption and decryption of sensitive data."""
    
    def __init__(self, encryption_key: str):
        """
        Initialize encryption service with a key.
        
        Args:
            encryption_key: Base encryption key from environment variable
        """
        if not encryption_key:
            raise ValueError("Encryption key cannot be empty")
        
        # Derive a proper Fernet key from the encryption key
        self._fernet = self._create_fernet_cipher(encryption_key)
    
    def _create_fernet_cipher(self, key: str) -> Fernet:
        """
        Create a Fernet cipher from the provided key.
        
        Args:
            key: String key to derive Fernet key from
            
        Returns:
            Fernet cipher instance
        """
        # Use PBKDF2HMAC to derive a proper 32-byte key
        kdf = PBKDF2HMAC(
            algorithm=hashes.SHA256(),
            length=32,
            salt=b'sdlc_orchestrator_salt',  # Static salt (in production, use dynamic per-user salt)
            iterations=100000,
        )
        key_bytes = key.encode('utf-8')
        derived_key = base64.urlsafe_b64encode(kdf.derive(key_bytes))
        return Fernet(derived_key)
    
    def encrypt(self, plaintext: str) -> str:
        """
        Encrypt a plaintext string.
        
        Args:
            plaintext: String to encrypt
            
        Returns:
            Encrypted string (base64 encoded)
        """
        if not plaintext:
            return ""
        
        try:
            encrypted_bytes = self._fernet.encrypt(plaintext.encode('utf-8'))
            return encrypted_bytes.decode('utf-8')
        except Exception as e:
            logger.error(f"Encryption failed: {e}")
            raise ValueError(f"Failed to encrypt data: {e}")
    
    def decrypt(self, encrypted_text: str) -> str:
        """
        Decrypt an encrypted string.
        
        Args:
            encrypted_text: Encrypted string (base64 encoded)
            
        Returns:
            Decrypted plaintext string
        """
        if not encrypted_text:
            return ""
        
        try:
            decrypted_bytes = self._fernet.decrypt(encrypted_text.encode('utf-8'))
            return decrypted_bytes.decode('utf-8')
        except Exception as e:
            logger.error(f"Decryption failed: {e}")
            raise ValueError(f"Failed to decrypt data: {e}")
    
    def encrypt_dict_fields(self, data: dict, fields_to_encrypt: list) -> dict:
        """
        Encrypt specific fields in a dictionary.
        
        Args:
            data: Dictionary containing data
            fields_to_encrypt: List of field names to encrypt
            
        Returns:
            Dictionary with specified fields encrypted
        """
        encrypted_data = data.copy()
        for field in fields_to_encrypt:
            if field in encrypted_data and encrypted_data[field]:
                encrypted_data[field] = self.encrypt(encrypted_data[field])
        return encrypted_data
    
    def decrypt_dict_fields(self, data: dict, fields_to_decrypt: list) -> dict:
        """
        Decrypt specific fields in a dictionary.
        
        Args:
            data: Dictionary containing encrypted data
            fields_to_decrypt: List of field names to decrypt
            
        Returns:
            Dictionary with specified fields decrypted
        """
        decrypted_data = data.copy()
        for field in fields_to_decrypt:
            if field in decrypted_data and decrypted_data[field]:
                decrypted_data[field] = self.decrypt(decrypted_data[field])
        return decrypted_data


# Singleton instance
_encryption_service_instance = None


def get_encryption_service(encryption_key: str = None) -> EncryptionService:
    """
    Get or create the singleton encryption service instance.
    
    Args:
        encryption_key: Encryption key (required on first call)
        
    Returns:
        EncryptionService instance
    """
    global _encryption_service_instance
    
    if _encryption_service_instance is None:
        if not encryption_key:
            raise ValueError("Encryption key required for first initialization")
        _encryption_service_instance = EncryptionService(encryption_key)
    
    return _encryption_service_instance
