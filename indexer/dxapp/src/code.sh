#!/bin/bash

mktempdl() {
    url="$1"
    echo $(basename $(mktemp -p . --suffix $(printf ".%s" "${url##*.}")))
}

rewrite_url() {
    # DNAnexus-specific optimization: rewrite https://dl.dnanex.us/ URL to use local proxy
    # just for downloading a temporary copy of the file to be indexed
    echo "$1" | sed "s#https://dl.dnanex.us/#http://10.0.3.1:8090/#"
}

main() {
    set -ex -o pipefail

    N="${#accessions[@]}"
    if [ "$N" -ne "${#urls[@]}" ]; then
        dx-jobutil-report-error "accessions and urls arrays must have the same length" AppError
    fi

    mkdir -p /home/dnanexus/out/index_db
    cd /tmp
    dlpid=""
    dlfn=""
    for i in $(seq 0 $(expr $N - 1)); do
        if [ "$i" -eq 0 ]; then
            nexturl=$(rewrite_url "${urls[0]}")
            dlfn=$(mktempdl "${urls[0]}")
            rm "$dlfn"
            aria2c -x 10 -j 10 -s 10 -m 10 --retry-wait 30 -o "$dlfn" "$nexturl" & dlpid=$!
        fi
        wait $dlpid

        fn="$dlfn"
        if [ "$i" -lt "$(expr $N - 1)" ]; then
            nexturl=$(rewrite_url "${urls[$(expr $i + 1)]}")
            dlfn=$(mktempdl "$nexturl")
            rm "$dlfn"
            aria2c -x 10 -j 10 -s 10 -m 10 --retry-wait 30 -o "$dlfn" "$nexturl" & dlpid=$!
        fi

        if ! grep -F "${accessions[$i]}" <(echo "${urls[$i]}"); then
            dx-jobutil-report-error "Failed sanity check: URL ${urls[$i]} doesn't contain accession ${accessions[$i]}"
            exit 1
        fi

        exe=""
        case "${fn##*.}" in
            bam)
                exe=htsnexus_index_bam
                ;;
            cram)
                exe=htsnexus_index_cram
                ;;
            *)
                dx-jobutil-report-error "Unrecognized extension/format ${fn##*.}"
                exit 1
                ;;
        esac

        "$exe" --reference "$reference" /home/dnanexus/out/index_db/htsnexus_index "$namespace" "${accessions[$i]}" "$fn" "${urls[$i]}"
        rm "$fn"
    done

    if [ "$downsample" == "true" ]; then
        htsnexus_downsample_index.py /home/dnanexus/out/index_db/htsnexus_index
        ls -s /home/dnanexus/out/index_db/
        mv /home/dnanexus/out/index_db/htsnexus_index.downsampled /home/dnanexus/out/index_db/htsnexus_index
    fi

    id=$(pigz -c /home/dnanexus/out/index_db/htsnexus_index |
            dx upload --destination "${output_name}" --type htsnexus_index --brief -)
    dx-jobutil-add-output index_db "$id"
}
