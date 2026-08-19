# app/graph/services/state_manager.py
import json
import boto3
import concurrent.futures
from botocore.exceptions import ClientError
from app.core.config import settings
from app.graph.state import SDLCStateDocument

class StateManager:
    def __init__(self, bucket_name: str | None = None):
        self.bucket = bucket_name or settings.SDLC_STATE_BUCKET
        self.s3 = boto3.client(
            's3',
            aws_access_key_id=settings.AWS_ACCESS_KEY_ID,
            aws_secret_access_key=settings.AWS_SECRET_ACCESS_KEY,
            region_name=settings.AWS_REGION,
            verify=False
        )

    def get_state(self, username: str, project_id: str) -> SDLCStateDocument:
        try:
            response = self.s3.get_object(Bucket=self.bucket, Key=f"users/{username}/{project_id}/state.json")
            data = json.loads(response['Body'].read())
            return SDLCStateDocument(**data)
        except self.s3.exceptions.NoSuchKey:
            return SDLCStateDocument(project_id=project_id, username=username)

    def update_state(self, state_doc: SDLCStateDocument) -> None:
        if not state_doc.username:
            raise ValueError("state_doc must have a username to be saved.")
        try:
            self.s3.put_object(
                Bucket=self.bucket,
                Key=f"users/{state_doc.username}/{state_doc.project_id}/state.json",
                Body=state_doc.model_dump_json(),
                ContentType="application/json",
            )
        except ClientError as exc:
            raise RuntimeError(f"Failed to persist state for project '{state_doc.project_id}': {exc}") from exc

    def delete_state(self, username: str, project_id: str) -> None:
        try:
            self.s3.delete_object(
                Bucket=self.bucket,
                Key=f"users/{username}/{project_id}/state.json"
            )
        except ClientError as exc:
            raise RuntimeError(f"Failed to delete state for project '{project_id}': {exc}") from exc

    def list_projects(self, username: str) -> list[SDLCStateDocument]:
        """
        THREAD-SAFE CONCURRENT SCALER: Allocates isolated client workers 
        to resolve socket dropped-connection drops.
        """
        try:
            projects = []
            paginator = self.s3.get_paginator('list_objects_v2')
            keys_to_fetch = []
            
            for page in paginator.paginate(Bucket=self.bucket, Prefix=f"users/{username}/"):
                if 'Contents' not in page:
                    continue
                for obj in page['Contents']:
                    if obj['Key'].endswith('/state.json'):
                        parts = obj['Key'].split('/')
                        if len(parts) >= 3:
                            keys_to_fetch.append(parts[-2])

            # Isolated execution closure to prevent shared state network crashes
            def fetch_single_project(proj_id):
                try:
                    thread_isolated_s3 = boto3.client(
                        's3',
                        aws_access_key_id=settings.AWS_ACCESS_KEY_ID,
                        aws_secret_access_key=settings.AWS_SECRET_ACCESS_KEY,
                        region_name=settings.AWS_REGION,
                        verify=False
                    )
                    response = thread_isolated_s3.get_object(
                        Bucket=self.bucket, 
                        Key=f"users/{username}/{proj_id}/state.json"
                    )
                    data = json.loads(response['Body'].read())
                    return SDLCStateDocument(**data)
                except Exception:
                    return None

            with concurrent.futures.ThreadPoolExecutor(max_workers=10) as executor:
                results = executor.map(fetch_single_project, keys_to_fetch)
                for res in results:
                    if res:
                        projects.append(res)
            
            return projects
        except ClientError as exc:
            raise RuntimeError(f"Failed to list projects: {exc}") from exc

    def list_analyzer_projects(self, username: str) -> list[dict]:
        ira_bucket = settings.IRA_BUCKET_NAME
        base_prefix = "brd-generation/users/nandan_dev/projects/"
        synced_projects = []
        try:
            resp = self.s3.list_objects_v2(Bucket=ira_bucket, Prefix=base_prefix, Delimiter='/')
            project_prefixes = [p['Prefix'] for p in resp.get('CommonPrefixes', [])]
            for proj_prefix in project_prefixes:
                proj_name = proj_prefix.replace(base_prefix, '').strip('/')
                threads_prefix = f"{proj_prefix}threads/"
                t_resp = self.s3.list_objects_v2(Bucket=ira_bucket, Prefix=threads_prefix)
                if 'Contents' not in t_resp: continue
                threads = sorted(t_resp['Contents'], key=lambda x: x['LastModified'], reverse=True)
                latest_thread_key = threads[0]['Key']
                obj = self.s3.get_object(Bucket=ira_bucket, Key=latest_thread_key)
                thread_data = json.loads(obj['Body'].read().decode('utf-8'))
                jira_output = thread_data.get('jira_output', {})
                if isinstance(jira_output, dict) and jira_output.get('is_synced'):
                    synced_projects.append({"project_name": proj_name, "jira_project_key": jira_output.get("project_key")})
            return synced_projects
        except Exception:
            return []