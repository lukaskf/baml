from baml_client.baml_types import Conversation
from baml_client.testing import baml_test
from .main import pipeline

@baml_test
async def test_pipeline_1():
    await pipeline(Conversation(**{
        "messages": [
            {
                "sender": "User",
                "content": "I need my carpet cleaned."
            },
        ]
    }))

@baml_test
async def test_pipeline_2():
    await pipeline(Conversation(**{
        "messages": [
            { "sender": "User", "content": "Hey! my home is dirty AF. can you clean it?"},
            { "sender": "User", "content": "its probably cause of my dogs"},
            { "sender": "AI", "content": "Sure I need some details"},
            { "sender": "User", "content": "Its 4 rooms, 3 have carpet"},
        ]
    }))