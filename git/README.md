# git/ (PortableGit)

## 자동 설치 (권장)
저장소 루트의 `install_runtime.bat`을 더블클릭하면 이 폴더를 포함해
필요한 런타임을 전부 자동으로 받아 설치한다. 아래는 수동으로 하고 싶을
때의 절차다.

## 수동 설치

이 폴더에 Windows용 PortableGit을 압축 해제해서 넣는다.

1. https://git-scm.com/download/win 에서 "PortableGit" (예: `PortableGit-x.y.z-64-bit.7z.exe`)
   를 받는다.
2. 실행하면 압축이 풀리며 설치 경로를 물어보는데, 이 폴더(`git/`)를 지정한다.

```
git\
├── bin\
│   └── git.exe
├── cmd\
│   └── git.exe
└── ...
```

`start.bat`이 `git\bin`, `git\cmd`를 세션 PATH에 추가한다.

> 이 폴더의 실제 바이너리는 저장소에 커밋하지 않는다 (`.gitignore` 참고).
